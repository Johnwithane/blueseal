import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";

// Helpers for the pre-acceptance applicant Q&A thread at
// jobPosts/{postId}/applications/{tradieId}/messages. This is application-scoped
// negotiation messaging — deliberately NOT the job chat. The job chat (chats/)
// is jobId-keyed and only created at acceptance; never route an application
// thread through it or you'd create pre-job chat docs with a null jobId and
// break onMessageCreated's /jobs/{jobId} linking.

export function applicationDocRef(postId: string, applicationId: string) {
  return db.doc(`jobPosts/${postId}/applications/${applicationId}`);
}

export function applicationMessagesCol(postId: string, applicationId: string) {
  return db.collection(`jobPosts/${postId}/applications/${applicationId}/messages`);
}

/**
 * Append a "system" line to an application thread (e.g. "Submitted a revised
 * quote", "Client declined this quote") and bump the denormalized thread
 * preview on the parent application doc. Best-effort: a failure here must not
 * fail the underlying revise/decline action. Does NOT touch unread counts —
 * system lines are informational and shouldn't bell-spam either party.
 */
export async function postApplicationSystemMessage(
  postId: string,
  applicationId: string,
  text: string,
): Promise<void> {
  if (!text || !text.trim()) return;
  const preview = text.slice(0, 120);
  try {
    await applicationMessagesCol(postId, applicationId).add({
      senderId: "system",
      text: text.slice(0, 2000),
      createdAt: FieldValue.serverTimestamp(),
      type: "system",
      senderName: null,
      senderPhotoURL: null,
    });
    await applicationDocRef(postId, applicationId).update({
      threadLastMessageAt: FieldValue.serverTimestamp(),
      threadLastMessagePreview: preview,
    });
  } catch (err) {
    logger.warn("postApplicationSystemMessage failed", { postId, applicationId, err });
  }
}
