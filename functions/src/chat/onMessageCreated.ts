import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";

interface MessageLike {
  senderId: string;
  text?: string;
  photoUrl?: string | null;
}

interface ChatLike {
  clientId: string;
  tradespersonId: string;
}

/**
 * On new chat message: bump lastMessage metadata + increment unreadCount
 * for the *other* party only.
 */
export const onMessageCreated = onDocumentCreated(
  "chats/{chatId}/messages/{messageId}",
  async (event) => {
    const msg = event.data?.data() as MessageLike | undefined;
    if (!msg?.senderId) return;
    const chatRef = db.doc(`chats/${event.params.chatId}`);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) return;
    const chat = chatSnap.data() as ChatLike;
    const recipient = chat.clientId === msg.senderId ? chat.tradespersonId : chat.clientId;
    const preview = msg.photoUrl ? "📷 Photo" : (msg.text ?? "").slice(0, 120);
    await chatRef.update({
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: preview,
      [`unreadCounts.${recipient}`]: FieldValue.increment(1),
    });
  },
);
