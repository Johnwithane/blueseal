import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  limit as fbLimit,
  limitToLast,
} from "firebase/firestore";
import { auth as fbAuth, db } from "@/firebase/config";
import type { ChatDoc, MessageDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const chatsCol = () => collection(db, "chats").withConverter(typedConverter<ChatDoc>());
const chatRef = (id: string) => doc(db, "chats", id).withConverter(typedConverter<ChatDoc>());

/**
 * Admin: every chat thread a user is party to (as tradesperson OR client),
 * newest-active first. Two queries (Firestore can't OR across fields) merged +
 * deduped by id. Needs the (tradespersonId, lastMessageAt DESC) + (clientId,
 * lastMessageAt DESC) indexes. Admin can read any chat per firestore.rules.
 * Threads with no messages yet (lastMessageAt null) are omitted by the orderBy.
 */
export async function listChatsForUser(uid: string, max = 50): Promise<WithId<ChatDoc>[]> {
  const [asTradie, asClient] = await Promise.all([
    getDocs(query(chatsCol(), where("tradespersonId", "==", uid), orderBy("lastMessageAt", "desc"), fbLimit(max))),
    getDocs(query(chatsCol(), where("clientId", "==", uid), orderBy("lastMessageAt", "desc"), fbLimit(max))),
  ]);
  const byId = new Map<string, WithId<ChatDoc>>();
  for (const d of [...asTradie.docs, ...asClient.docs]) byId.set(d.id, { id: d.id, ...d.data() });
  return [...byId.values()]
    .sort((a, b) => (b.lastMessageAt?.toMillis?.() ?? 0) - (a.lastMessageAt?.toMillis?.() ?? 0))
    .slice(0, max);
}
const msgsCol = (chatId: string) =>
  collection(db, "chats", chatId, "messages").withConverter(typedConverter<MessageDoc>());

const ALLOWED_STORAGE_HOSTS = [
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
];

function isAllowedPhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return ALLOWED_STORAGE_HOSTS.some(
      (host) => u.hostname === host || u.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

export async function createChat(opts: {
  jobId: string;
  clientId: string;
  tradespersonId: string;
  // Caller can pre-allocate an id so the chat's jobId can carry the real
  // value at create time (the rules lock jobId post-create — there is no
  // "patch it later" path). The request-quote flow needs this so the
  // job/chat pair is consistent before any messages get notified on.
  chatId?: string;
}): Promise<string> {
  const chatId = opts.chatId ?? doc(collection(db, "chats")).id;
  await setDoc(chatRef(chatId), {
    jobId: opts.jobId,
    clientId: opts.clientId,
    tradespersonId: opts.tradespersonId,
    lastMessageAt: null,
    lastMessagePreview: "",
    unreadCounts: { [opts.clientId]: 0, [opts.tradespersonId]: 0 },
  });
  return chatId;
}

/** Stable id for an unsaved chat — see `createChat({ chatId })`. */
export function newChatId(): string {
  return doc(collection(db, "chats")).id;
}

export async function getChat(id: string): Promise<WithId<ChatDoc> | null> {
  const snap = await getDoc(chatRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function sendMessage(opts: {
  chatId: string;
  senderId: string;
  senderName: string | null;
  senderPhotoURL: string | null;
  text: string;
  photoUrl?: string | null;
}): Promise<void> {
  // Refuse photo URLs that aren't on Firebase Storage hosts — a malicious
  // sender shouldn't be able to embed arbitrary URLs (incl. `javascript:`)
  // that the chat UI then renders to other users.
  if (opts.photoUrl && !isAllowedPhotoUrl(opts.photoUrl)) {
    throw new Error("Invalid photo URL.");
  }
  if (opts.senderPhotoURL && !isAllowedPhotoUrl(opts.senderPhotoURL)) {
    // Avatar URL came from the user doc, which is owner-writable — same
    // hosting-allowlist rule as inline photos to keep the chat surface safe.
    throw new Error("Invalid sender photo URL.");
  }
  const text = (opts.text ?? "").slice(0, 5000);
  const preview = opts.photoUrl ? "📷 Photo" : text.slice(0, 120);
  await addDoc(msgsCol(opts.chatId), {
    senderId: opts.senderId,
    text,
    photoUrl: opts.photoUrl ?? null,
    createdAt: serverTimestamp() as never,
    type: opts.photoUrl ? "photo" : "text",
    senderName: (opts.senderName ?? "").slice(0, 80) || null,
    senderPhotoURL: opts.senderPhotoURL ?? null,
  });
  // Denormalized chat metadata. Cloud Function recomputes unreadCounts
  // authoritatively; this client-side write keeps the inbox preview snappy.
  await updateDoc(doc(db, "chats", opts.chatId), {
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: preview,
  });
}

export function subscribeChat(
  chatId: string,
  cb: (chat: WithId<ChatDoc> | null) => void,
): () => void {
  return onSnapshot(
    chatRef(chatId),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => console.warn(`[Firestore] chats/${chatId} listener:`, err.code, err.message),
  );
}

export function subscribeMessages(
  chatId: string,
  cb: (messages: WithId<MessageDoc>[]) => void,
  options?: { tail?: number },
): () => void {
  // Default to the last 200 messages — long chats shouldn't load fully.
  const q = options?.tail
    ? query(msgsCol(chatId), orderBy("createdAt", "asc"), limitToLast(options.tail))
    : query(msgsCol(chatId), orderBy("createdAt", "asc"), limitToLast(200));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.warn(`[Firestore] chats/${chatId}/messages listener:`, err.code, err.message),
  );
}

/** Clear unread badge for the *current* user only. UID always comes from auth. */
export async function markRead(chatId: string): Promise<void> {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) return;
  await updateDoc(doc(db, "chats", chatId), { [`unreadCounts.${uid}`]: 0 });
}

// Silence "unused" warning during partial refactors — kept for future pagination.
void fbLimit;

/** Origin allowlist exposed for UI sanitization. */
export { isAllowedPhotoUrl };
