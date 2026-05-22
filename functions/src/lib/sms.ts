import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "./admin";

/**
 * Writes to the `sms` collection consumed by the Firebase "Send SMS with
 * Twilio" extension (Twilio Labs). The extension is configurable to read
 * from any collection name; install it pointed at `sms` and these docs
 * flush as outbound texts. If the extension isn't installed yet, docs
 * accumulate and flush once it is — same pattern as `enqueueMail` and the
 * trigger-email extension.
 *
 * Doc shape matches the Twilio extension's expected input: `to` (E.164
 * phone) and `body` (string ≤1600 chars; Twilio splits long messages into
 * multiple segments).
 */
export interface SmsInput {
  to: string;
  body: string;
}

// E.164: leading "+", country code, then digits. Strict enough to reject
// "0412" or "(555) 123-4567" before paying for an invalid send.
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

function validPhone(addr: string): boolean {
  return E164_REGEX.test(addr);
}

export async function enqueueSms(input: SmsInput): Promise<void> {
  if (!validPhone(input.to)) {
    logger.warn("Refusing to enqueue SMS to invalid phone", { to: input.to });
    return;
  }
  // Single-segment SMS cap is 160 GSM chars; Twilio splits beyond that.
  // We hard-cap at 480 (3 segments) to bound cost from accidental long
  // messages — anything bigger likely belongs in an email anyway.
  const body = (input.body ?? "").slice(0, 480);
  if (!body.trim()) {
    logger.warn("Refusing to enqueue empty SMS", { to: input.to });
    return;
  }

  await db.collection("sms").add({
    to: input.to,
    body,
    createdAt: FieldValue.serverTimestamp(),
  });
}
