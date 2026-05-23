import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import type {
  AssistantConversationDoc,
  AssistantMessageDoc,
  AssistantScope,
  WithId,
} from "@/firebase/interfaces";

const convosCol = () =>
  collection(db, "assistantConversations").withConverter(
    typedConverter<AssistantConversationDoc>(),
  );

const messagesCol = (conversationId: string) =>
  collection(db, "assistantConversations", conversationId, "messages").withConverter(
    typedConverter<AssistantMessageDoc>(),
  );

export interface AiChatInput {
  conversationId?: string;
  scope: AssistantScope;
  jobId?: string | null;
  pageRoute?: string | null;
  message: string;
  // When true the user-side message isn't rendered in the thread — used by
  // the quick-prompt chips so clicking "Summarize" feels like a one-click
  // command instead of typing a templated prompt. The message still
  // persists server-side so the model keeps context across follow-ups.
  hidden?: boolean;
}

export interface AiChatResult {
  ok: true;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  reply: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Send a chat turn to the assistant. The backend creates the conversation
 * doc if `conversationId` is omitted and persists both the user message and
 * the assistant reply atomically — so once this resolves, the messages
 * subscription will deliver both turns in order.
 *
 * Strips nullish optional fields before sending — the Firebase callable SDK
 * marshalls `undefined` as `null` on the wire, which the server's Zod schema
 * would reject for non-nullable optional keys (e.g. conversationId on the
 * very first turn).
 */
export async function sendAssistantMessage(input: AiChatInput): Promise<AiChatResult> {
  const fn = httpsCallable<Record<string, unknown>, AiChatResult>(functions, "aiChat");
  const payload: Record<string, unknown> = {
    scope: input.scope,
    message: input.message,
  };
  if (input.conversationId) payload.conversationId = input.conversationId;
  if (input.jobId) payload.jobId = input.jobId;
  if (input.pageRoute) payload.pageRoute = input.pageRoute;
  if (input.hidden) payload.hidden = true;
  const { data } = await fn(payload);
  return data;
}

/**
 * Find the existing conversation for this scope. There's at most one per
 * (userId, scope, jobId) tuple — the backend enforces this on auto-create.
 * Returns null if the thread doesn't exist yet.
 */
export async function findAssistantConversation(opts: {
  userId: string;
  scope: AssistantScope;
  jobId: string | null;
}): Promise<WithId<AssistantConversationDoc> | null> {
  const snap = await getDocs(
    query(
      convosCol(),
      where("userId", "==", opts.userId),
      where("scope", "==", opts.scope),
      where("jobId", "==", opts.jobId),
      limit(1),
    ),
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

/**
 * Subscribe to a conversation's messages in order. Tails the last 200 — long
 * conversations should paginate older history on demand (not yet
 * implemented; assistant threads are short by nature).
 */
export function subscribeAssistantMessages(
  conversationId: string,
  cb: (messages: WithId<AssistantMessageDoc>[]) => void,
): () => void {
  const q = query(messagesCol(conversationId), orderBy("createdAt", "asc"), limitToLast(200));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/**
 * Subscribe to all of a user's assistant conversations, newest activity
 * first. Used for the in-panel thread picker.
 */
export function subscribeAssistantConversations(
  userId: string,
  cb: (conversations: WithId<AssistantConversationDoc>[]) => void,
): () => void {
  const q = query(
    convosCol(),
    where("userId", "==", userId),
    orderBy("lastMessageAt", "desc"),
    limit(50),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/** Owner-only delete. Rules also enforce this server-side. */
export async function deleteAssistantConversation(conversationId: string): Promise<void> {
  await deleteDoc(doc(db, "assistantConversations", conversationId));
}

/**
 * Ask the AI for 2–3 short reply candidates the tradesperson could send
 * in the job's client↔tradie chat. Tradie-only callable; returns an empty
 * suggestions array if the most recent message was the tradesperson's own
 * (saving a Vertex call).
 */
export interface AiSuggestRepliesResult {
  ok: true;
  suggestions: string[];
  reason?: string;
}
export async function suggestChatReplies(jobId: string): Promise<AiSuggestRepliesResult> {
  const fn = httpsCallable<{ jobId: string }, AiSuggestRepliesResult>(
    functions,
    "aiSuggestReplies",
  );
  const { data } = await fn({ jobId });
  return data;
}

/**
 * Ask the AI to scan new client chat activity since the last log update
 * and append a one-line entry to the job's privateNotes (if there's
 * anything action-relevant to log). Tradie-only.
 *
 * `force: true` bypasses the server-side cooldown (used by the manual
 * "Update log" button). Omit or pass false for the automatic trigger on
 * JobDetailView mount — the server short-circuits on cooldown and
 * returns `{skipped: true, reason: "cooldown"}` cheaply.
 */
export interface AiUpdateJobLogResult {
  ok: true;
  skipped: boolean;
  appended: string | null;
  reason: string | null;
}
export async function updateJobLog(
  jobId: string,
  opts: { force?: boolean } = {},
): Promise<AiUpdateJobLogResult> {
  const fn = httpsCallable<
    { jobId: string; force?: boolean },
    AiUpdateJobLogResult
  >(functions, "aiUpdateJobLog");
  const payload: { jobId: string; force?: boolean } = { jobId };
  if (opts.force) payload.force = true;
  const { data } = await fn(payload);
  return data;
}
