// Public unsubscribe endpoint linked from the roster-invite email footer
// (hosting rewrite: /roster-invite-unsub). Token-gated with the same HMAC
// pattern as unsubscribeProjectInvite — HMAC(secret, "roster_invite_" +
// inviteId), never stored on any doc — so the URL can't enumerate invites or
// revoke arbitrary ones. Writes the SHARED, PERMANENT inviteSuppression tombstone
// keyed by emailHash (opting out covers job + project + roster invite emails)
// and revokes this pending invite.

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

export const unsubscribeRosterInvite = onRequest(
  { region: "us-central1", cors: false },
  async (request, response) => {
    const inviteId = String(request.query.i ?? "");
    const token = String(request.query.t ?? "");
    if (!inviteId || !token) {
      response.status(400).send(page("Invalid unsubscribe link."));
      return;
    }

    // Constant-time compare + uniform 200 regardless of validity, so the
    // endpoint can't be used as a token-validity / invite-existence oracle.
    const ok = page(
      "If this link was valid, you've been unsubscribed from Blue Seal invite emails.",
    );
    const expected = unsubTokenFor(`roster_invite_${inviteId}`);
    const valid =
      !!expected &&
      expected.length === token.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    if (!valid) {
      response.status(200).send(ok);
      return;
    }

    try {
      const ref = db.doc(`rosterInvites/${inviteId}`);
      const snap = await ref.get();
      const emailLower = snap.exists ? (snap.get("emailLower") as string | undefined) : undefined;
      if (!emailLower) {
        response.status(200).send(ok); // already gone — idempotent
        return;
      }

      const batch = db.batch();
      batch.set(db.doc(`inviteSuppression/${emailHashOf(emailLower)}`), {
        reason: "unsubscribe",
        identifier: emailHashOf(emailLower),
        createdAt: FieldValue.serverTimestamp(),
      });
      if (snap.get("status") === "pending_signup") {
        batch.update(ref, { status: "revoked", revokedAt: FieldValue.serverTimestamp() });
      }
      await batch.commit();

      logger.info("unsubscribeRosterInvite: unsubscribed", { inviteId });
      response.status(200).send(ok);
    } catch (err) {
      logger.error("unsubscribeRosterInvite: failed", { inviteId, err });
      response.status(500).send(page("Something went wrong. Please try again later."));
    }
  },
);
