import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "./admin";

/**
 * Writes to the `whatsapp` collection consumed by `processWhatsAppMessage`
 * (a Cloud Function trigger in this repo that calls Meta's WhatsApp Cloud
 * API). Free for the first 1,000 service conversations/month per Meta's
 * pricing — that's the reason we picked WhatsApp over SMS as the default
 * high-priority channel.
 *
 * If `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` env vars aren't set, the
 * processor logs and exits — queued docs stay put and flush retroactively
 * once you complete the HUMANTASKS.md setup steps.
 *
 * You can also point a third-party Firebase extension (Twilio Labs
 * Send WhatsApp Message, MessageBird, etc.) at this same `whatsapp/`
 * collection — the processor disables itself if the env vars are missing,
 * so the two approaches don't collide.
 */
export interface WhatsAppInput {
  to: string; // E.164 phone with leading "+", e.g. "+15875551234"
  body: string;
}

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

function validPhone(addr: string): boolean {
  return E164_REGEX.test(addr);
}

export async function enqueueWhatsApp(input: WhatsAppInput): Promise<void> {
  if (!validPhone(input.to)) {
    logger.warn("Refusing to enqueue WhatsApp to invalid phone", { to: input.to });
    return;
  }
  // 1024-char cap matches the practical limit of a single WhatsApp text
  // body; templates can carry more via parameters.
  const body = (input.body ?? "").slice(0, 1024);
  if (!body.trim()) {
    logger.warn("Refusing to enqueue empty WhatsApp", { to: input.to });
    return;
  }

  await db.collection("whatsapp").add({
    to: input.to,
    body,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });
}
