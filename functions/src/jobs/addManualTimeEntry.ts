import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  // What this session bills against — same options as clockIn.
  kind: z.enum(["labour", "travel", "extra"]).default("labour"),
  // Required when kind === "extra": the approved extra to bill against.
  extraId: z.string().min(1).max(128).nullish(),
  // Epoch-ms for the worked window (the client builds these from the form's
  // local date + start/end time).
  startedAtMs: z.number().int().positive(),
  endedAtMs: z.number().int().positive(),
  notes: z.string().max(2000).default(""),
});

interface JobLike {
  tradespersonId?: string;
  clientId?: string;
  status?: string;
  chatId?: string;
  billingType?: "hourly" | "fixed" | null;
}

// A single manually-logged session is capped at 24h — anything longer is almost
// certainly a typo (wrong date on one end).
const MAX_ENTRY_MS = 24 * 60 * 60 * 1000;
// Small grace for clock skew when rejecting "future" time.
const FUTURE_GRACE_MS = 5 * 60 * 1000;

/**
 * Manually log a CLOSED time entry for work the tradesperson didn't clock live
 * (forgot to start the timer, did the work off-app, etc.).
 *
 * Unlike clockIn this writes an already-closed entry (both startedAt + endedAt
 * set) and deliberately does NOT touch the running clock or the
 * one-running-session invariant — a manual entry is historical, so there's no
 * open session to guard and nothing to auto-stop.
 *
 * Rate resolves server-side from the same inputs clockIn uses, so a logged hour
 * bills identically to a clocked one. The resolution is kept INLINE (mirroring
 * clockIn.ts) rather than shared, to avoid touching the live clock path while
 * functions/ has no test coverage — keep the two in sync.
 */
export const addManualTimeEntry = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);

  const { jobId, kind, startedAtMs, endedAtMs, notes } = parsed.data;
  const extraId = parsed.data.extraId ?? null;
  if (kind === "extra" && !extraId) {
    throw new HttpsError("invalid-argument", "An extra must be specified to log time against it.");
  }

  // ----- validate the worked window -----
  const durationMs = endedAtMs - startedAtMs;
  if (durationMs <= 0) {
    throw new HttpsError("invalid-argument", "The end time must be after the start time.");
  }
  if (durationMs > MAX_ENTRY_MS) {
    throw new HttpsError("invalid-argument", "A single entry can't be longer than 24 hours.");
  }
  if (endedAtMs > Date.now() + FUTURE_GRACE_MS) {
    throw new HttpsError("invalid-argument", "You can't log time in the future.");
  }

  const jobRef = db.doc(`jobs/${jobId}`);
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const extraRef = extraId ? jobRef.collection("extras").doc(extraId) : null;

  const [jobSnap, tradieSnap, extraSnap] = await Promise.all([
    jobRef.get(),
    tradieRef.get(),
    extraRef ? extraRef.get() : Promise.resolve(null),
  ]);

  if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
  const job = jobSnap.data() as JobLike;
  if (job.tradespersonId !== uid) {
    throw new HttpsError("permission-denied", "Only the assigned tradesperson can log time.");
  }
  if (job.status === "cancelled") {
    throw new HttpsError("failed-precondition", "Can't log time on a cancelled job.");
  }
  if (!job.clientId) {
    throw new HttpsError("failed-precondition", "Job is missing a client.");
  }

  const tradie = tradieSnap.exists
    ? (tradieSnap.data() as { hourlyRate?: number | null; travelRate?: number | null })
    : null;
  const profileHourly = Math.max(0, Math.floor(tradie?.hourlyRate ?? 0));
  const isFixed = job.billingType === "fixed";

  // ----- resolve the rate (mirrors clockIn.ts — keep in sync) -----
  let rate: number;
  if (kind === "travel") {
    if (isFixed) {
      throw new HttpsError(
        "failed-precondition",
        "Travel can't be billed directly on a fixed-price job — add it as an extra for the client to approve.",
      );
    }
    const travel = Math.max(0, Math.floor(tradie?.travelRate ?? 0));
    rate = travel > 0 ? travel : profileHourly;
  } else if (kind === "extra") {
    if (!extraSnap || !extraSnap.exists) {
      throw new HttpsError("not-found", "Extra not found.");
    }
    const extra = extraSnap.data() as {
      tradespersonId?: string;
      status?: string;
      billingType?: string;
      hourlyRateCents?: number | null;
    };
    if (extra.tradespersonId !== uid) {
      throw new HttpsError("permission-denied", "Not your extra.");
    }
    if (extra.status !== "approved") {
      throw new HttpsError("failed-precondition", "This extra hasn't been approved by the client yet.");
    }
    if (extra.billingType !== "hourly") {
      throw new HttpsError("failed-precondition", "This extra isn't billed hourly.");
    }
    rate = Math.max(0, Math.floor(extra.hourlyRateCents ?? 0));
  } else {
    rate = isFixed ? 0 : profileHourly;
  }

  const entryRef = jobRef.collection("timeEntries").doc();
  await entryRef.set({
    tradespersonId: uid,
    clientId: job.clientId,
    startedAt: Timestamp.fromMillis(startedAtMs),
    endedAt: Timestamp.fromMillis(endedAtMs),
    hourlyRateSnapshot: rate,
    notes: notes.slice(0, 2000),
    source: "manual",
    kind,
    extraId: kind === "extra" ? extraId : null,
    invoicedAt: null,
  });

  logger.info("addManualTimeEntry", {
    jobId,
    tradespersonId: uid,
    entryId: entryRef.id,
    kind,
    extraId,
    rate,
    durationMs,
  });

  // Best-effort transparency line — the client already sees the entry in the
  // live time log, but a chat note flags that hours were added after the fact.
  if (job.chatId) {
    const mins = Math.floor(durationMs / 60_000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const dur = h > 0 ? `${h}h ${m}m` : `${m}m`;
    const what = kind === "travel" ? "travel time" : kind === "extra" ? "change-order time" : "time";
    await postSystemMessage(job.chatId, `Tradesperson logged ${dur} of ${what}`);
  }

  return { entryId: entryRef.id };
});
