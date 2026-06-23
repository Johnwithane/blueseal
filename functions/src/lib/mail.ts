import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "./admin";

/**
 * Writes to the `mail` collection consumed by the Firebase "Trigger Email"
 * extension. If the extension isn't installed yet, the document still
 * accumulates and will flush once you install + configure it.
 *
 * `attachments[].path` deliberately excluded — the Trigger Email extension
 * can be coerced into reading arbitrary local paths if `path` is ever
 * populated from untrusted input. Inline `content` only.
 */
export interface MailInput {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; content: string }>;
  // Optional Reply-To. The "Trigger Email" extension honours a top-level
  // `replyTo`, so a customer who hits reply reaches a monitored inbox (e.g.
  // hello@blueseal.app) rather than the no-reply From. Validated like `to`.
  replyTo?: string;
  // Optional CC recipients (e.g. the admin keeping a copy of an outreach send).
  // The "Trigger Email" extension reads `message.cc`. Each is validated like
  // `to`; invalid addresses are dropped rather than failing the whole send.
  cc?: string[];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validEmail(addr: string): boolean {
  return addr.length <= 200 && EMAIL_REGEX.test(addr);
}

export async function enqueueMail(input: MailInput): Promise<void> {
  const to = Array.isArray(input.to) ? input.to : [input.to];
  if (!to.every(validEmail)) {
    logger.warn("Refusing to enqueue mail to invalid address", { to });
    return;
  }
  // Length-bound subject + body to keep abuse surface small.
  const subject = (input.subject ?? "").slice(0, 200);
  const text = (input.text ?? "").slice(0, 50_000);
  const html = (input.html ?? "").slice(0, 100_000);
  // Drop an invalid reply-to rather than rejecting the whole send.
  const replyTo = input.replyTo && validEmail(input.replyTo) ? input.replyTo : undefined;
  // Drop invalid / duplicate CCs; keep the send going for the valid ones.
  const cc = (input.cc ?? [])
    .filter(validEmail)
    .filter((addr) => !to.includes(addr));
  const uniqueCc = [...new Set(cc)];

  await db.collection("mail").add({
    to,
    ...(replyTo ? { replyTo } : {}),
    message: {
      subject,
      text,
      html,
      ...(uniqueCc.length ? { cc: uniqueCc } : {}),
      attachments: input.attachments ?? [],
    },
    createdAt: FieldValue.serverTimestamp(),
  });
}
