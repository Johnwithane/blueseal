import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  limit as fbLimit,
  limitToLast,
} from "firebase/firestore";
import { auth as fbAuth, db } from "@/firebase/config";
import type { ChatDoc, MessageDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const chatRef = (id: string) => doc(db, "chats", id).withConverter(typedConverter<ChatDoc>());
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
}): Promise<string> {
  const chatId = doc(collection(db, "chats")).id;
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

export async function getChat(id: string): Promise<WithId<ChatDoc> | null> {
  const snap = await getDoc(chatRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function sendMessage(opts: {
  chatId: string;
  senderId: string;
  text: string;
  photoUrl?: string | null;
}): Promise<void> {
  // Refuse photo URLs that aren't on Firebase Storage hosts — a malicious
  // sender shouldn't be able to embed arbitrary URLs (incl. `javascript:`)
  // that the chat UI then renders to other users.
  if (opts.photoUrl && !isAllowedPhotoUrl(opts.photoUrl)) {
    throw new Error("Invalid photo URL.");
  }
  const text = (opts.text ?? "").slice(0, 5000);
  const preview = opts.photoUrl ? "📷 Photo" : text.slice(0, 120);
  await addDoc(msgsCol(opts.chatId), {
    senderId: opts.senderId,
    text,
    photoUrl: opts.photoUrl ?? null,
    createdAt: serverTimestamp() as never,
    type: opts.photoUrl ? "photo" : "text",
  });
  // Denormalized chat metadata. Cloud Function recomputes unreadCounts
  // authoritatively; this client-side write keeps the inbox preview snappy.
  await updateDoc(doc(db, "chats", opts.chatId), {
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: preview,
  });
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
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
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
