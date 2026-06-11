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

/**
 * Copy the pre-acceptance Q&A thread into the new job chat so the negotiation
 * carries over when an application converts to a job — the conversation
 * shouldn't evaporate at acceptance. Original senders + timestamps are
 * preserved (the chat reads chronologically); copies are flagged
 * `carriedOver: true`, which onMessageCreated skips, so no unread bumps or
 * notification spam for history both parties already read. Capped at the most
 * recent `cap` messages. Best-effort: a copy failure must never fail the
 * accept (the thread also remains readable on the closed post).
 *
 * This is a one-time COPY at the acceptance boundary, not a unification of
 * the two systems — see the module comment above for why application threads
 * stay separate from chats/ before a job exists.
 */
export async function copyApplicationThreadToChat(
  postId: string,
  applicationId: string,
  chatId: string,
  cap = 200,
): Promise<void> {
  try {
    const snap = await applicationMessagesCol(postId, applicationId)
      .orderBy("createdAt", "desc")
      .limit(cap)
      .get();
    if (snap.empty) return;
    const docs = [...snap.docs].reverse(); // back to chronological order
    const chatMessages = db.collection(`chats/${chatId}/messages`);

    // Firestore batches cap at 500 ops; chunk defensively.
    let batch = db.batch();
    let ops = 0;
    for (const d of docs) {
      const m = d.data() as {
        senderId: string;
        text?: string;
        createdAt?: FirebaseFirestore.Timestamp;
        type?: string;
        senderName?: string | null;
        senderPhotoURL?: string | null;
      };
      batch.set(chatMessages.doc(), {
        senderId: m.senderId,
        text: m.text ?? "",
        photoUrl: null,
        createdAt: m.createdAt ?? FieldValue.serverTimestamp(),
        type: m.type === "system" ? "system" : "text",
        senderName: m.senderName ?? null,
        senderPhotoURL: m.senderPhotoURL ?? null,
        carriedOver: true,
      });
      ops++;
      if (ops >= 450) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    // Seed the chat-list preview from the carried history (no unread bump —
    // nothing here is new to either party). Any post-accept system message
    // lands after this and overwrites it.
    const last = docs[docs.length - 1].data() as {
      text?: string;
      createdAt?: FirebaseFirestore.Timestamp;
    };
    batch.update(db.doc(`chats/${chatId}`), {
      lastMessageAt: last.createdAt ?? FieldValue.serverTimestamp(),
      lastMessagePreview: (last.text ?? "").slice(0, 120),
    });
    await batch.commit();
    logger.info("copyApplicationThreadToChat", { postId, applicationId, chatId, copied: docs.length });
  } catch (err) {
    logger.warn("copyApplicationThreadToChat failed", { postId, applicationId, chatId, err });
  }
}
