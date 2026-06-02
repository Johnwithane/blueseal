// Public unsubscribe / takedown endpoint linked from the outreach email footer.
// Token-gated (the prospect's unsubToken), so the URL can't be used to
// enumerate or suppress arbitrary prospects. Writes a PERMANENT suppression
// tombstone (keyed by emailHash) so the prospect is never re-imported, and
// drops them from search immediately.

import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { timingSafeEqual } from "node:crypto";
import { db } from "../lib/admin";
import { unsubTokenFor } from "./helpers";

function page(message: string): string {
  return (
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Blue Seal</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#111827;">` +
    `<h1 style="font-size:20px;">Blue Seal</h1><p>${message}</p></body></html>`
  );
}

export const suppressProspect = onRequest(
  { region: "us-central1", cors: false },
  async (request, response) => {
    const prospectId = String(request.query.p ?? "");
    const token = String(request.query.t ?? "");
    if (!prospectId || !token) {
      response.status(400).send(page("Invalid unsubscribe link."));
      return;
    }

    // Verify the HMAC token (never stored on any doc, so it can't leak from the
    // world-readable prospect doc — only someone holding the email link has it).
    // Constant-time compare + a UNIFORM 200 response regardless of validity, so
    // the endpoint can't be used as a token-validity / existence oracle. Only a
    // real match writes the suppression tombstone.
    const ok = page("If this link was valid, you've been unsubscribed and won't be contacted again.");
    const expected = unsubTokenFor(prospectId);
    const valid =
      !!expected &&
      expected.length === token.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    if (!valid) {
      response.status(200).send(ok);
      return;
    }

    try {
      const ref = db.doc(`prospects/${prospectId}`);
      const snap = await ref.get();
      if (!snap.exists) {
        response.status(200).send(ok); // already gone — idempotent
        return;
      }
      const data = snap.data() as Record<string, unknown>;

      const emailHash = typeof data.emailHash === "string" ? data.emailHash : null;
      const batch = db.batch();
      // Permanent tombstone keyed by emailHash so re-imports skip them forever.
      if (emailHash) {
        batch.set(db.doc(`prospectSuppression/${emailHash}`), {
          reason: "unsubscribe",
          identifier: emailHash,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: null,
        });
      }
      // Drop from search + mark suppressed.
      batch.update(ref, {
        status: "suppressed",
        isListed: false,
        suppressedAt: FieldValue.serverTimestamp(),
        suppressedReason: "unsubscribe",
      });
      await batch.commit();

      logger.info("suppressProspect: unsubscribed", { prospectId });
      response.status(200).send(ok);
    } catch (err) {
      logger.error("suppressProspect: failed", { prospectId, err });
      response.status(500).send(page("Something went wrong. Please try again later."));
    }
  },
);
