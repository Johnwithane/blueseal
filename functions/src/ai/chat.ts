import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { VertexAI, type Content } from "@google-cloud/vertexai";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

/**
 * aiChat — persistent multi-turn assistant for tradespeople + admins.
 *
 * Shape:
 *   - Conversations live at /assistantConversations/{id} with messages in a
 *     subcollection. One conversation per (userId, scope, jobId) tuple:
 *       scope "job"     → one thread per job the tradie/admin opens
 *       scope "general" → one rolling thread per user for non-job questions
 *       scope "admin"   → one thread per admin for cross-page admin help
 *
 *   - When scope is "job", the per-turn prompt is grounded in the job's
 *     intake form data + the human client↔tradie chat transcript (last 40
 *     messages). This matches what aiDiagnose/aiQuote/aiSummarize already
 *     do — those are kept for now but should be retired in a follow-up
 *     commit (see design.md §5.9; subsume-into-chatbot decision 2026-05-22).
 *
 *   - Writes are server-only (admin SDK bypasses rules). The user turn and
 *     the assistant reply persist in a single batch so a client subscribing
 *     to the messages collection sees them appear together — no
 *     "in-flight" partial state.
 *
 *   - Subscription gate: OFF during development. Flip REQUIRE_SUBSCRIPTION
 *     to true before launch (HUMANTASKS has the reminder).
 */

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "blueseal-762af";
const LOCATION = process.env.VERTEX_LOCATION || "us-central1";
const MODEL = process.env.VERTEX_MODEL || "gemini-2.5-flash";

const REQUIRE_SUBSCRIPTION = false;

// Rolling history window — Gemini Flash handles long context but each turn
// re-bills the prior history. 16 turns keeps a usable working memory without
// runaway cost.
const HISTORY_TURNS = 16;
// Human-chat transcript window, when scope === "job".
const HUMAN_CHAT_TAIL = 40;

const Input = z
  .object({
    conversationId: z.string().min(1).max(128).optional(),
    scope: z.enum(["job", "general", "admin"]),
    jobId: z.string().min(1).max(128).nullable().optional(),
    pageRoute: z.string().max(200).nullable().optional(),
    message: z.string().trim().min(1).max(4000),
  })
  .refine(
    (v) => v.scope !== "job" || (typeof v.jobId === "string" && v.jobId.length > 0),
    { message: "scope=job requires jobId", path: ["jobId"] },
  );

interface ConversationDoc {
  userId: string;
  scope: "job" | "general" | "admin";
  jobId: string | null;
  title: string;
  messageCount: number;
}

interface JobDoc {
  trade: string;
  title: string;
  description: string;
  status: string;
  intakeFormData: Record<string, unknown>;
  intakePhotos: string[];
  tradespersonId: string;
  clientId: string;
  chatId: string;
}

interface MessageDoc {
  senderId: string;
  text: string;
}

function tokenRoles(req: CallableRequest<unknown>): string[] {
  const token = req.auth?.token as { role?: unknown; roles?: unknown } | undefined;
  if (!token) return [];
  if (Array.isArray(token.roles)) return token.roles.filter((r): r is string => typeof r === "string");
  if (typeof token.role === "string") return [token.role];
  return [];
}

let vertexClient: VertexAI | null = null;
function client(): VertexAI {
  if (!vertexClient) vertexClient = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return vertexClient;
}

function buildSystemPrompt(opts: {
  isAdmin: boolean;
  scope: "job" | "general" | "admin";
  pageRoute: string | null;
  jobContext: { job: JobDoc; chatTranscript: string[] } | null;
}): string {
  const tradieBase =
    "You are Blue Seal's in-app assistant for tradespeople in Canada. " +
    "Help with on-site diagnosis, quoting, scheduling logistics, supplier suggestions, " +
    "and explaining how Blue Seal works. Be concise and practical. Use Canadian " +
    "spellings (e.g. 'metre', 'colour'), Canadian dollars (CAD), and metric units. " +
    "When the user hasn't given you enough information, ask one focused follow-up " +
    "question rather than guessing.";

  const adminBase =
    "You are Blue Seal's in-app assistant for admins. Help with reviewing tradesperson " +
    "vetting, summarising job + user state, and spotting issues in the data the admin " +
    "is currently viewing. Be concise and factual. Do not propose destructive actions " +
    "(deletes, bans, refunds) without a clear basis — instead, suggest the admin verify " +
    "and act through the UI.";

  const lines: string[] = [opts.isAdmin ? adminBase : tradieBase];

  if (opts.pageRoute) {
    lines.push(`\nThe user is currently viewing the route: ${opts.pageRoute}.`);
  }

  if (opts.scope === "job" && opts.jobContext) {
    const { job, chatTranscript } = opts.jobContext;
    const intake =
      Object.entries(job.intakeFormData ?? {})
        .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
        .join("\n") || "(no intake answers yet)";
    lines.push("\n--- Current job context ---");
    lines.push(`Trade: ${job.trade}`);
    lines.push(`Title: ${job.title}`);
    lines.push(`Status: ${job.status}`);
    lines.push(`Description: ${job.description}`);
    lines.push(`Intake details:\n${intake}`);
    if (chatTranscript.length > 0) {
      lines.push(`\nRecent client ↔ tradesperson chat (oldest first):\n${chatTranscript.join("\n")}`);
    } else {
      lines.push("\nNo messages yet on this job's chat.");
    }
    lines.push("--- End job context ---");
  } else if (opts.scope === "general") {
    lines.push(
      "\nThis is a general thread — the user isn't asking about a specific job. " +
        "If their question is clearly about a particular job, ask which one.",
    );
  }

  return lines.join("\n");
}

async function loadJobContext(
  jobId: string,
  callerUid: string,
  isAdmin: boolean,
): Promise<{ job: JobDoc; chatTranscript: string[] }> {
  const jobSnap = await db.doc(`jobs/${jobId}`).get();
  if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
  const job = jobSnap.data() as JobDoc;
  if (job.tradespersonId !== callerUid && !isAdmin) {
    throw new HttpsError("permission-denied", "You can only ask the assistant about your own jobs.");
  }
  const msgsSnap = await db
    .collection(`chats/${job.chatId}/messages`)
    .orderBy("createdAt", "asc")
    .limitToLast(HUMAN_CHAT_TAIL)
    .get();
  const transcript = msgsSnap.docs.map((d) => {
    const m = d.data() as MessageDoc;
    const who = m.senderId === job.tradespersonId ? "Tradie" : "Client";
    return `${who}: ${m.text ?? ""}`;
  });
  return { job, chatTranscript: transcript };
}

export const aiChat = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const input = parsed.data;
  const roles = tokenRoles(req);
  const isAdmin = roles.includes("admin");
  const isTradesperson = roles.includes("tradesperson");

  if (!isTradesperson && !isAdmin) {
    throw new HttpsError("permission-denied", "The assistant is available to tradespeople and admins.");
  }
  if (input.scope === "admin" && !isAdmin) {
    throw new HttpsError("permission-denied", "Admin scope requires the admin role.");
  }

  // Subscription gate (currently off during dev — see HUMANTASKS).
  if (REQUIRE_SUBSCRIPTION && isTradesperson && !isAdmin) {
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.data() as { hasActiveSubscription?: boolean } | undefined;
    if (!userData?.hasActiveSubscription) {
      throw new HttpsError("permission-denied", "The assistant requires an active subscription.");
    }
  }

  const logCtx = { fn: "aiChat", uid, scope: input.scope, jobId: input.jobId ?? null };

  // Resolve / create the conversation.
  let conversationId = input.conversationId;
  let conversation: ConversationDoc;
  if (conversationId) {
    const snap = await db.doc(`assistantConversations/${conversationId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Conversation not found.");
    conversation = snap.data() as ConversationDoc;
    if (conversation.userId !== uid) {
      throw new HttpsError("permission-denied", "Not your conversation.");
    }
  } else {
    // Find existing thread for this (uid, scope, jobId) — uniqueness is by
    // convention here, not enforced by Firestore. The "find then create"
    // window is small (single-user-single-tab is the common case) and a
    // duplicate at worst means two threads for the same scope, which the
    // user can delete.
    const existing = await db
      .collection("assistantConversations")
      .where("userId", "==", uid)
      .where("scope", "==", input.scope)
      .where("jobId", "==", input.jobId ?? null)
      .limit(1)
      .get();
    if (!existing.empty) {
      conversationId = existing.docs[0].id;
      conversation = existing.docs[0].data() as ConversationDoc;
    } else {
      let title = "General";
      if (input.scope === "admin") {
        title = "Admin assistant";
      } else if (input.scope === "job" && input.jobId) {
        const jobSnap = await db.doc(`jobs/${input.jobId}`).get();
        if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
        const job = jobSnap.data() as JobDoc;
        if (job.tradespersonId !== uid && !isAdmin) {
          throw new HttpsError("permission-denied", "You can only ask about your own jobs.");
        }
        title = job.title || `${job.trade} job`;
      }
      const newConvo: ConversationDoc = {
        userId: uid,
        scope: input.scope,
        jobId: input.jobId ?? null,
        title,
        messageCount: 0,
      };
      const ref = await db.collection("assistantConversations").add({
        ...newConvo,
        lastMessageAt: null,
        lastMessagePreview: "",
        createdAt: FieldValue.serverTimestamp(),
      });
      conversationId = ref.id;
      conversation = newConvo;
    }
  }

  // Load job context for job-scoped conversations (re-check ownership each
  // turn — the job's tradie assignment could in theory change between turns).
  let jobContext: { job: JobDoc; chatTranscript: string[] } | null = null;
  if (conversation.scope === "job" && conversation.jobId) {
    jobContext = await loadJobContext(conversation.jobId, uid, isAdmin);
  }

  // Load prior turns for replay.
  const priorSnap = await db
    .collection(`assistantConversations/${conversationId}/messages`)
    .orderBy("createdAt", "asc")
    .limitToLast(HISTORY_TURNS)
    .get();
  const priorTurns = priorSnap.docs.map((d) => d.data() as { role: string; content: string });

  const systemPrompt = buildSystemPrompt({
    isAdmin,
    scope: conversation.scope,
    pageRoute: input.pageRoute ?? null,
    jobContext,
  });

  const contents: Content[] = [];
  for (const m of priorTurns) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  contents.push({ role: "user", parts: [{ text: input.message }] });

  let assistantText = "";
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const model = client().getGenerativeModel({
      model: MODEL,
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    });
    const res = await model.generateContent({ contents });
    assistantText =
      res.response.candidates?.[0]?.content?.parts
        ?.map((p) => ("text" in p ? p.text : ""))
        .join("") ?? "";
    tokensIn = res.response.usageMetadata?.promptTokenCount ?? 0;
    tokensOut = res.response.usageMetadata?.candidatesTokenCount ?? 0;
  } catch (err) {
    logger.error("aiChat: Vertex call failed", { ...logCtx, err: (err as Error).message });
    // Never leak raw provider errors — they can contain project IDs / hosts.
    throw new HttpsError(
      "internal",
      "The AI service is unavailable right now. Please try again shortly.",
    );
  }
  if (!assistantText) {
    assistantText = "I couldn't generate a response. Try rephrasing or asking something else.";
  }

  // Persist both turns + bump conversation metadata atomically.
  const batch = db.batch();
  const msgsCol = db.collection(`assistantConversations/${conversationId}/messages`);
  const userMsgRef = msgsCol.doc();
  const asstMsgRef = msgsCol.doc();
  const convoRef = db.doc(`assistantConversations/${conversationId}`);

  batch.set(userMsgRef, {
    role: "user",
    content: input.message,
    createdAt: FieldValue.serverTimestamp(),
    tokensIn: null,
    tokensOut: null,
    contextSnapshot: {
      pageRoute: input.pageRoute ?? null,
      jobId: conversation.jobId,
      chatMessagesIncluded: jobContext?.chatTranscript.length ?? 0,
    },
  });
  batch.set(asstMsgRef, {
    role: "assistant",
    content: assistantText,
    createdAt: FieldValue.serverTimestamp(),
    tokensIn,
    tokensOut,
    contextSnapshot: null,
  });
  batch.update(convoRef, {
    lastMessageAt: FieldValue.serverTimestamp(),
    lastMessagePreview: assistantText.slice(0, 120),
    messageCount: FieldValue.increment(2),
  });
  await batch.commit();

  await db.collection("aiUsage").add({
    userId: uid,
    jobId: conversation.jobId,
    tool: "chat",
    tokensIn,
    tokensOut,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info("aiChat: success", { ...logCtx, conversationId, tokensIn, tokensOut });

  return {
    ok: true,
    conversationId,
    userMessageId: userMsgRef.id,
    assistantMessageId: asstMsgRef.id,
    reply: assistantText,
    tokensIn,
    tokensOut,
  };
});
