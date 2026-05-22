import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "./admin";
import { enqueueMail } from "./mail";
import { enqueueSms } from "./sms";

// Keep in sync with src/firebase/interfaces.ts → NotificationType.
// Cross-package boundary means we can't share the type literally; the
// NotificationsPanel renderer + service consume the src/ copy.
export type NotificationType =
  | "message_received"
  | "job_requested"
  | "new_application"
  | "application_accepted"
  | "application_rejected"
  | "application_returned"
  | "vetting_approved"
  | "vetting_rejected"
  | "vetting_info_requested"
  | "cert_approved"
  | "id_approved"
  | "invoice_sent"
  | "review_received";

/**
 * Channel routing per notification.
 *  - "low": in-app inbox only. Use for high-volume/low-stakes (e.g. someone
 *    typing in chat — the inbox is enough; we don't want to email them on
 *    every line).
 *  - "normal" (default): in-app + email digest. Standard for things the
 *    user should see today but not be paged about.
 *  - "high": in-app + email + SMS. Reserved for time-critical events —
 *    new job request, application accepted, vetting decision.
 */
export type NotifyPriority = "low" | "normal" | "high";

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  jobId?: string | null;
  chatId?: string | null;
  actorUid?: string | null;
  priority?: NotifyPriority;
}

interface UserContact {
  email: string | null;
  phone: string | null;
}

async function getUserContact(uid: string): Promise<UserContact> {
  try {
    const snap = await db.doc(`users/${uid}`).get();
    const data = snap.data() as { email?: string; phone?: string } | undefined;
    return {
      email: data?.email ?? null,
      phone: data?.phone ?? null,
    };
  } catch (err) {
    logger.warn("notify: failed to load user contact", { uid, err });
    return { email: null, phone: null };
  }
}

function absoluteUrl(link: string | null | undefined): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  const base = (process.env.APP_BASE_URL ?? "https://blueseal.app").replace(/\/$/, "");
  return `${base}${link.startsWith("/") ? "" : "/"}${link}`;
}

/**
 * Write the notification + (depending on priority) email + SMS. Failures in
 * any channel are logged but never thrown — a notification miss must not
 * break the user-facing action that triggered it.
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (!input.userId) {
    logger.warn("notify: missing userId; skipping", { type: input.type });
    return;
  }
  const priority: NotifyPriority = input.priority ?? "normal";
  const title = input.title.slice(0, 120);
  const body = input.body.slice(0, 500);
  const link = input.link ?? null;

  // In-app inbox always.
  try {
    await db.collection("notifications").add({
      userId: input.userId,
      type: input.type,
      title,
      body,
      link,
      read: false,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
      jobId: input.jobId ?? null,
      chatId: input.chatId ?? null,
      actorUid: input.actorUid ?? null,
    });
  } catch (err) {
    logger.error("notify: in-app write failed", { type: input.type, userId: input.userId, err });
  }

  if (priority === "low") return;

  const contact = await getUserContact(input.userId);
  const url = absoluteUrl(link);
  const cta = url ? `\n\nOpen Blue Seal: ${url}` : "";

  // Email on normal + high.
  if (contact.email) {
    try {
      await enqueueMail({
        to: contact.email,
        subject: title,
        text: `${body}${cta}`,
      });
    } catch (err) {
      logger.error("notify: email enqueue failed", {
        type: input.type,
        userId: input.userId,
        err,
      });
    }
  }

  // SMS only on high — and only if the user has a phone on file.
  if (priority === "high" && contact.phone) {
    try {
      // SMS body is space-bound; lead with the title so it's useful even
      // if the carrier truncates. Append the link so the user can act.
      const smsBody = url ? `${title} — ${url}` : title;
      await enqueueSms({ to: contact.phone, body: smsBody });
    } catch (err) {
      logger.error("notify: sms enqueue failed", {
        type: input.type,
        userId: input.userId,
        err,
      });
    }
  }
}

/** Convenience: write the same notification body to multiple recipients. */
export async function notifyMany(
  userIds: string[],
  base: Omit<NotifyInput, "userId">,
): Promise<void> {
  await Promise.all(userIds.map((uid) => notify({ ...base, userId: uid })));
}
