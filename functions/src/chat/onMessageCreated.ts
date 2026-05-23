import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";

interface MessageLike {
  senderId: string;
  text?: string;
  photoUrl?: string | null;
  type?: string;
}

interface ChatLike {
  clientId: string;
  tradespersonId: string;
  jobId: string;
}

/**
 * On new chat message: bump lastMessage metadata + increment unreadCount
 * for the *other* party only, and drop a notification in their inbox.
 */
export const onMessageCreated = onDocumentCreated(
  "chats/{chatId}/messages/{messageId}",
  async (event) => {
    const msg = event.data?.data() as MessageLike | undefined;
    if (!msg?.senderId) return;
    // System messages (auto-posted by status/schedule/clock triggers) bump
    // lastMessage metadata in the writer itself; we don't want to notify on
    // them — both parties are already looking at the event that caused
    // them, and pinging the bell on every schedule edit is too noisy.
    if (msg.type === "system" || msg.senderId === "system") return;
    const chatId = event.params.chatId;
    const chatRef = db.doc(`chats/${chatId}`);
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
    // Pull the sender's display name for a more human notification.
    const senderSnap = await db.doc(`users/${msg.senderId}`).get();
    const senderName = (senderSnap.data() as { displayName?: string } | undefined)?.displayName
      ?? "Someone";
    await notify({
      userId: recipient,
      type: "message_received",
      title: `New message from ${senderName}`,
      body: preview,
      link: `/jobs/${chat.jobId}`,
      jobId: chat.jobId,
      chatId,
      actorUid: msg.senderId,
      // Chat is high-volume; in-app + bell badge is enough. Email/SMS on
      // every line would be unbearable.
      priority: "low",
    });
  },
);
