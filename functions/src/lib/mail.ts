import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";

/**
 * Writes to the `mail` collection consumed by the Firebase "Trigger Email"
 * extension. If the extension isn't installed yet, the document still
 * accumulates and will flush once you install + configure it.
 */
export interface MailInput {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; path?: string; content?: string }>;
}

export async function enqueueMail(input: MailInput): Promise<void> {
  await db.collection("mail").add({
    to: input.to,
    message: {
      subject: input.subject,
      text: input.text ?? "",
      html: input.html ?? "",
      attachments: input.attachments ?? [],
    },
    createdAt: FieldValue.serverTimestamp(),
  });
}
