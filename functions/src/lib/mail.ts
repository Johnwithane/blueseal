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

  await db.collection("mail").add({
    to,
    message: {
      subject,
      text,
      html,
      attachments: input.attachments ?? [],
    },
    createdAt: FieldValue.serverTimestamp(),
  });
}
