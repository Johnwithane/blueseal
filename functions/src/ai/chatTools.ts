import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { FunctionDeclarationSchemaType, type Tool } from "@google-cloud/vertexai";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";

/**
 * Tools exposed to Gemini when the assistant is scoped to a job and the
 * caller is the assigned tradesperson. Read tools (getJobStatus,
 * getCurrentTimer) are safe always; the rest mutate state, so we gate
 * them at the call site in chat.ts — the model only sees this list when
 * the caller has permission to act.
 *
 * Permission model: each write tool re-checks ownership in its own
 * transaction (defence in depth — chat.ts gates the toolset, but a future
 * refactor shouldn't accidentally widen access). Admins do NOT get
 * write-tool access via the assistant; cross-user actions go through
 * dedicated admin callables with explicit audit trails.
 *
 * Conversation history note: tool calls + responses are NOT persisted in
 * the assistantConversations subcollection — only the final user/assistant
 * text turns are. Tool effects show up in Firestore state (job notes,
 * schedule, time entries) which the model can re-read via getJobStatus
 * on the next turn if it needs to.
 */
export const JOB_TOOLS: Tool = {
  functionDeclarations: [
    {
      name: "getJobStatus",
      description:
        "Read the current state of this job: title, status, scheduled times, private notes, and any running time-tracking session. Call this when you need fresh data — e.g. after making changes, or when the user asks 'what's the schedule?' or 'am I clocked in?'.",
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: {},
      },
    },
    {
      name: "getCurrentTimer",
      description:
        "Return whether a time-tracking session is currently running on this job and, if so, how long it's been running.",
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: {},
      },
    },
    {
      name: "appendPrivateNote",
      description:
        "Append a timestamped line to the tradesperson's private notes on this job. Existing notes are preserved. Use for things like 'arrived on site at 9:15', 'client requested ceramic instead of porcelain', or 'used 2m of 1/2-inch PEX'. Don't include the timestamp in `note` — it's added automatically.",
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: {
          note: {
            type: FunctionDeclarationSchemaType.STRING,
            description: "The note text to append (max 2000 chars).",
          },
        },
        required: ["note"],
      },
    },
    {
      name: "setSchedule",
      description:
        "Set or update the scheduled start and end times for this job. Times must be ISO 8601 strings with timezone (e.g. '2026-05-25T09:00:00-07:00' for 9am Pacific). If endISO is omitted the existing end time is kept. Status is never changed by this tool — scheduling is metadata, not a status gate.",
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: {
          startISO: {
            type: FunctionDeclarationSchemaType.STRING,
            description: "Scheduled start (ISO 8601 with timezone)",
          },
          endISO: {
            type: FunctionDeclarationSchemaType.STRING,
            description: "Scheduled end (ISO 8601 with timezone), optional",
          },
        },
        required: ["startISO"],
      },
    },
    {
      name: "clockIn",
      description:
        "Start a new time-tracking session for the tradesperson on this job. Fails if a session is already running. The hourly rate is snapshotted from the tradesperson's profile at clock-in time so a later rate change doesn't re-price this session.",
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: {},
      },
    },
    {
      name: "clockOut",
      description:
        "Close the currently running time-tracking session on this job. Returns elapsed minutes and the billed amount in cents. Optional `notes` are attached to the entry (max 500 chars).",
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: {
          notes: {
            type: FunctionDeclarationSchemaType.STRING,
            description: "Optional notes about the session",
          },
        },
      },
    },
  ],
};

export interface ToolContext {
  jobId: string;
  /** UID of the calling user (must be the assigned tradesperson for write tools). */
  uid: string;
  /** True if the caller has the admin role — currently used only for read-tool widening. */
  isAdmin: boolean;
}

export type ToolResult = Record<string, unknown>;

interface JobShape {
  tradespersonId: string;
  clientId: string;
  status: string;
  title?: string;
  privateNotes?: string;
  scheduledStart?: Timestamp | null;
  scheduledEnd?: Timestamp | null;
}

function dateLabel(): string {
  return new Date().toLocaleString("en-CA", { dateStyle: "short", timeStyle: "short" });
}

async function loadJob(jobId: string): Promise<JobShape | null> {
  const snap = await db.doc(`jobs/${jobId}`).get();
  if (!snap.exists) return null;
  return snap.data() as JobShape;
}

/** Read-only — admin allowed (they often need to look at a job). */
async function toolGetJobStatus(ctx: ToolContext): Promise<ToolResult> {
  const job = await loadJob(ctx.jobId);
  if (!job) return { ok: false, error: "Job not found." };
  if (job.tradespersonId !== ctx.uid && !ctx.isAdmin) {
    return { ok: false, error: "Not your job." };
  }
  const timer = await toolGetCurrentTimer(ctx);
  return {
    ok: true,
    title: job.title ?? null,
    status: job.status,
    scheduledStart: job.scheduledStart?.toDate().toISOString() ?? null,
    scheduledEnd: job.scheduledEnd?.toDate().toISOString() ?? null,
    privateNotes: job.privateNotes ?? "",
    runningTimer: timer,
  };
}

/** Read-only — admin allowed. Tradies see only their own timer; admin sees any. */
async function toolGetCurrentTimer(ctx: ToolContext): Promise<ToolResult> {
  let q = db
    .collection(`jobs/${ctx.jobId}/timeEntries`)
    .where("endedAt", "==", null) as FirebaseFirestore.Query;
  if (!ctx.isAdmin) q = q.where("tradespersonId", "==", ctx.uid);
  const snap = await q.limit(1).get();
  if (snap.empty) return { ok: true, running: false };
  const doc = snap.docs[0];
  const e = doc.data() as {
    startedAt: Timestamp;
    hourlyRateSnapshot: number;
    tradespersonId: string;
  };
  const elapsedMs = Date.now() - e.startedAt.toMillis();
  return {
    ok: true,
    running: true,
    entryId: doc.id,
    startedAt: e.startedAt.toDate().toISOString(),
    elapsedMinutes: Math.floor(elapsedMs / 60_000),
    hourlyRateSnapshotCents: e.hourlyRateSnapshot,
    tradespersonId: e.tradespersonId,
  };
}

/** Write — tradesperson only (admin actions go through dedicated callables). */
async function toolAppendPrivateNote(
  ctx: ToolContext,
  args: { note?: unknown },
): Promise<ToolResult> {
  const note = typeof args.note === "string" ? args.note.trim() : "";
  if (!note) return { ok: false, error: "Note is empty." };
  if (note.length > 2000) return { ok: false, error: "Note too long (max 2000 chars)." };

  const jobRef = db.doc(`jobs/${ctx.jobId}`);
  const updated = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new Error("Job not found.");
    const job = snap.data() as JobShape;
    if (job.tradespersonId !== ctx.uid) {
      throw new Error("Only the assigned tradesperson can update private notes.");
    }
    const existing = (job.privateNotes ?? "").trim();
    const line = `[${dateLabel()}] ${note}`;
    const next = existing ? `${existing}\n${line}` : line;
    tx.update(jobRef, { privateNotes: next });
    return next;
  });
  return { ok: true, privateNotes: updated };
}

/** Write — tradesperson only. Updates scheduled times only; status is not touched here. */
async function toolSetSchedule(
  ctx: ToolContext,
  args: { startISO?: unknown; endISO?: unknown },
): Promise<ToolResult> {
  const startStr = typeof args.startISO === "string" ? args.startISO.trim() : "";
  if (!startStr) return { ok: false, error: "startISO is required." };
  const start = new Date(startStr);
  if (isNaN(start.getTime())) return { ok: false, error: "startISO is not a valid date." };

  const endStr = typeof args.endISO === "string" ? args.endISO.trim() : "";
  const end = endStr ? new Date(endStr) : null;
  if (end && isNaN(end.getTime())) return { ok: false, error: "endISO is not a valid date." };
  if (end && end.getTime() <= start.getTime()) {
    return { ok: false, error: "endISO must be after startISO." };
  }

  const jobRef = db.doc(`jobs/${ctx.jobId}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new Error("Job not found.");
    const job = snap.data() as JobShape;
    if (job.tradespersonId !== ctx.uid) {
      throw new Error("Only the assigned tradesperson can change the schedule.");
    }
    const updates: { [key: string]: Timestamp } = {
      scheduledStart: Timestamp.fromDate(start),
    };
    if (end) updates.scheduledEnd = Timestamp.fromDate(end);
    tx.update(jobRef, updates);
    return {
      scheduledStart: start.toISOString(),
      scheduledEnd: end?.toISOString() ?? null,
      status: job.status,
    };
  });
  return { ok: true, ...result };
}

/** Write — tradesperson only. Mirrors clockIn callable's transactional uniqueness check. */
async function toolClockIn(ctx: ToolContext): Promise<ToolResult> {
  const jobRef = db.doc(`jobs/${ctx.jobId}`);
  const tradieRef = db.doc(`tradespeople/${ctx.uid}`);
  return await db.runTransaction(async (tx) => {
    const [jobSnap, tradieSnap] = await Promise.all([tx.get(jobRef), tx.get(tradieRef)]);
    if (!jobSnap.exists) return { ok: false, error: "Job not found." };
    const job = jobSnap.data() as JobShape;
    if (job.tradespersonId !== ctx.uid) {
      return { ok: false, error: "Only the assigned tradesperson can clock in." };
    }
    if (job.status === "cancelled") {
      return { ok: false, error: "Can't clock in on a cancelled job." };
    }
    if (!job.clientId) return { ok: false, error: "Job is missing a client." };

    const openQuery = jobRef
      .collection("timeEntries")
      .where("tradespersonId", "==", ctx.uid)
      .where("endedAt", "==", null)
      .limit(1);
    const openSnap = await tx.get(openQuery);
    if (!openSnap.empty) {
      return {
        ok: false,
        error: "You're already clocked in on this job. Stop the running session first.",
      };
    }

    const tradieData = tradieSnap.exists
      ? (tradieSnap.data() as { hourlyRate?: number | null })
      : null;
    const rate = Math.max(0, Math.floor(tradieData?.hourlyRate ?? 0));

    const entryRef = jobRef.collection("timeEntries").doc();
    tx.set(entryRef, {
      tradespersonId: ctx.uid,
      clientId: job.clientId,
      startedAt: FieldValue.serverTimestamp(),
      endedAt: null,
      hourlyRateSnapshot: rate,
      notes: "",
      source: "clock",
      invoicedAt: null,
    });
    return {
      ok: true,
      entryId: entryRef.id,
      hourlyRateSnapshotCents: rate,
      startedAtApproxISO: new Date().toISOString(),
    };
  });
}

/** Write — tradesperson only. Closes the currently running entry. */
async function toolClockOut(
  ctx: ToolContext,
  args: { notes?: unknown },
): Promise<ToolResult> {
  const notes =
    typeof args.notes === "string" ? args.notes.trim().slice(0, 500) : "";

  const openSnap = await db
    .collection(`jobs/${ctx.jobId}/timeEntries`)
    .where("tradespersonId", "==", ctx.uid)
    .where("endedAt", "==", null)
    .limit(1)
    .get();
  if (openSnap.empty) return { ok: false, error: "No running session to close." };
  const entryRef = openSnap.docs[0].ref;

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(entryRef);
    if (!snap.exists) return { ok: false, error: "Time entry not found." };
    const e = snap.data() as {
      tradespersonId: string;
      startedAt: Timestamp;
      endedAt: Timestamp | null;
      hourlyRateSnapshot: number;
    };
    if (e.tradespersonId !== ctx.uid) return { ok: false, error: "Not your time entry." };
    if (e.endedAt !== null) return { ok: false, error: "This session is already closed." };

    const now = Timestamp.now();
    const elapsedMs = Math.max(0, now.toMillis() - e.startedAt.toMillis());
    const mins = Math.floor(elapsedMs / 60_000);
    const billed = Math.round((elapsedMs / 3_600_000) * e.hourlyRateSnapshot);

    const update: { [key: string]: FieldValue | string } = {
      endedAt: FieldValue.serverTimestamp(),
    };
    if (notes) update.notes = notes;
    tx.update(entryRef, update);
    return {
      ok: true,
      entryId: entryRef.id,
      elapsedMinutes: mins,
      billedAmountCents: billed,
    };
  });
}

/**
 * Dispatch a tool call from the model. Each tool implementation catches its
 * own permission/precondition errors and returns `{ ok: false, error }`
 * back to the model — the model is much better at recovering ("oh, you're
 * already clocked in, want me to clock you out first?") than at
 * interpreting a raw HttpsError.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "getJobStatus":
        return await toolGetJobStatus(ctx);
      case "getCurrentTimer":
        return await toolGetCurrentTimer(ctx);
      case "appendPrivateNote":
        return await toolAppendPrivateNote(ctx, args);
      case "setSchedule":
        return await toolSetSchedule(ctx, args);
      case "clockIn":
        return await toolClockIn(ctx);
      case "clockOut":
        return await toolClockOut(ctx, args);
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    logger.warn("aiChat tool failed", { name, err: (err as Error).message });
    return { ok: false, error: (err as Error).message };
  }
}
