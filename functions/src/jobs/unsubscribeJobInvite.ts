// Public unsubscribe endpoint linked from the job-invite email footer
// (hosting rewrite: /jobs-invite-unsub). Token-gated with the same HMAC
// pattern as suppressProspect — HMAC(secret, "invite_" + jobId), never
// stored on any doc — so the URL can't be used to enumerate jobs or revoke
// arbitrary invites. Writes a PERMANENT inviteSuppression tombstone keyed
// by emailHash (all future invite EMAILS to that address are skipped;
// copy-link invites still work — opting out of email isn't opting out of
// the tradesperson they hired) and revokes this job's pending invite.

import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { timingSafeEqual } from "node:crypto";
import { db } from "../lib/admin";
import { emailHashOf, unsubTokenFor } from "../prospects/helpers";

function page(message: string): string {
  return (
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Blue Seal</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#111827;">` +
    `<h1 style="font-size:20px;">Blue Seal</h1><p>${message}</p></body></html>`
  );
}

export const unsubscribeJobInvite = onRequest(
  { region: "us-central1", cors: false },
  async (request, response) => {
    const jobId = String(request.query.j ?? "");
    const token = String(request.query.t ?? "");
    if (!jobId || !token) {
      response.status(400).send(page("Invalid unsubscribe link."));
      return;
    }

    // Constant-time compare + uniform 200 regardless of validity, so the
    // endpoint can't be used as a token-validity / job-existence oracle.
    const ok = page(
      "If this link was valid, you've been unsubscribed from Blue Seal invite emails.",
    );
    const expected = unsubTokenFor(`invite_${jobId}`);
    const valid =
      !!expected &&
      expected.length === token.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    if (!valid) {
      response.status(200).send(ok);
      return;
    }

    try {
      const jobRef = db.doc(`jobs/${jobId}`);
      const snap = await jobRef.get();
      const invite = snap.exists
        ? (snap.get("clientInvite") as { emailLower?: string; status?: string } | null)
        : null;
      if (!invite?.emailLower) {
        response.status(200).send(ok); // already gone — idempotent
        return;
      }

      const batch = db.batch();
      batch.set(db.doc(`inviteSuppression/${emailHashOf(invite.emailLower)}`), {
        reason: "unsubscribe",
        identifier: emailHashOf(invite.emailLower),
        createdAt: FieldValue.serverTimestamp(),
      });
      if (invite.status === "invited") {
        batch.update(jobRef, {
          "clientInvite.status": "revoked",
          "clientInvite.revokedAt": FieldValue.serverTimestamp(),
          "clientInvite.tokenHash": null,
        });
      }
      await batch.commit();

      logger.info("unsubscribeJobInvite: unsubscribed", { jobId });
      response.status(200).send(ok);
    } catch (err) {
      logger.error("unsubscribeJobInvite: failed", { jobId, err });
      response.status(500).send(page("Something went wrong. Please try again later."));
    }
  },
);
