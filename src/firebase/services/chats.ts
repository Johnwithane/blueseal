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
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { ChatDoc, MessageDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const chatRef = (id: string) => doc(db, "chats", id).withConverter(typedConverter<ChatDoc>());
const msgsCol = (chatId: string) =>
  collection(db, "chats", chatId, "messages").withConverter(typedConverter<MessageDoc>());

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
  recipientId: string;
  text: string;
  photoUrl?: string | null;
}): Promise<void> {
  const preview = opts.photoUrl ? "📷 Photo" : opts.text.slice(0, 120);
  await addDoc(msgsCol(opts.chatId), {
    senderId: opts.senderId,
    text: opts.text,
    photoUrl: opts.photoUrl ?? null,
    createdAt: serverTimestamp() as never,
    type: opts.photoUrl ? "photo" : "text",
  });
  // Denormalized chat metadata. Cloud Function also recomputes unreadCounts authoritatively;
  // this client-side write keeps the inbox preview snappy.
  await updateDoc(doc(db, "chats", opts.chatId), {
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: preview,
  });
}

export function subscribeMessages(
  chatId: string,
  cb: (messages: WithId<MessageDoc>[]) => void,
): () => void {
  const q = query(msgsCol(chatId), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function markRead(chatId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, "chats", chatId), { [`unreadCounts.${userId}`]: 0 });
}
