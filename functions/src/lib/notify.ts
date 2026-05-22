import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "./admin";

export type NotificationType =
  | "message_received"
  | "job_requested"
  | "application_accepted"
  | "application_rejected"
  | "vetting_approved"
  | "vetting_rejected"
  | "vetting_info_requested"
  | "cert_approved"
  | "cert_rejected"
  | "id_approved"
  | "id_rejected"
  | "invoice_sent"
  | "invoice_paid"
  | "review_received";

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  jobId?: string | null;
  chatId?: string | null;
  actorUid?: string | null;
}

/**
 * Write a single notification doc to `notifications/`. Failures are logged
 * but never thrown — a notification miss must not break the user-facing
 * action that triggered it (e.g. cert approval should still succeed even
 * if the inbox write fails).
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (!input.userId) {
    logger.warn("notify: missing userId; skipping", { type: input.type });
    return;
  }
  try {
    await db.collection("notifications").add({
      userId: input.userId,
      type: input.type,
      title: input.title.slice(0, 120),
      body: input.body.slice(0, 500),
      link: input.link ?? null,
      read: false,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
      jobId: input.jobId ?? null,
      chatId: input.chatId ?? null,
      actorUid: input.actorUid ?? null,
    });
  } catch (err) {
    logger.error("notify: failed to write", { type: input.type, userId: input.userId, err });
  }
}

/** Convenience: write the same notification body to multiple recipients. */
export async function notifyMany(
  userIds: string[],
  base: Omit<NotifyInput, "userId">,
): Promise<void> {
  await Promise.all(userIds.map((uid) => notify({ ...base, userId: uid })));
}
