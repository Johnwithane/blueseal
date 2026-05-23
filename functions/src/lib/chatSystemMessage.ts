import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "./admin";

/**
 * Append a "system" message to a chat. Used by job-update triggers and the
 * clockIn/clockOut callables so changes to status, schedule, and time
 * tracking land in the chat timeline alongside the parties' own messages.
 *
 * Admin SDK bypasses firestore.rules — the rules block `type == "system"`
 * for client writes, which is what we want (only server-trusted events end
 * up in the timeline). senderId is the literal "system" so the UI can
 * detect and render these without an avatar bubble.
 *
 * Also bumps the chat's lastMessage metadata to match a regular message —
 * the inbox preview shows "Tradesperson clocked in" etc. like any other
 * line. Unread count is *not* incremented: system messages are informational
 * and bell-spamming on every schedule edit would be intolerable.
 */
export async function postSystemMessage(chatId: string, text: string): Promise<void> {
  if (!chatId) return;
  if (!text || !text.trim()) return;
  const preview = text.slice(0, 120);
  try {
    const msgsCol = db.collection(`chats/${chatId}/messages`);
    await msgsCol.add({
      senderId: "system",
      text: text.slice(0, 5000),
      photoUrl: null,
      createdAt: FieldValue.serverTimestamp(),
      type: "system",
      senderName: null,
      senderPhotoURL: null,
    });
    await db.doc(`chats/${chatId}`).update({
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: preview,
    });
  } catch (err) {
    // Best-effort: a missing chat doc (legacy job created before chats
    // existed, or a manually-deleted thread) shouldn't fail the underlying
    // job update. Log and move on.
    logger.warn("postSystemMessage failed", { chatId, err });
  }
}
