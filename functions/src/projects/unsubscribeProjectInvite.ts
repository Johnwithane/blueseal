// Public unsubscribe endpoint linked from the project-invite email footer
// (hosting rewrite: /projects-invite-unsub). Token-gated with the same HMAC
// pattern as unsubscribeJobInvite — HMAC(secret, "project_invite_" + projectId),
// never stored on any doc — so the URL can't be used to enumerate projects or
// revoke arbitrary invites. Writes the SHARED, PERMANENT inviteSuppression
// tombstone keyed by emailHash (so opting out covers both job and project invite
// emails; copy-link invites still work) and revokes this project's pending invite.

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

export const unsubscribeProjectInvite = onRequest(
  { region: "us-central1", cors: false },
  async (request, response) => {
    const projectId = String(request.query.p ?? "");
    const token = String(request.query.t ?? "");
    if (!projectId || !token) {
      response.status(400).send(page("Invalid unsubscribe link."));
      return;
    }

    // Constant-time compare + uniform 200 regardless of validity, so the
    // endpoint can't be used as a token-validity / project-existence oracle.
    const ok = page(
      "If this link was valid, you've been unsubscribed from Blue Seal invite emails.",
    );
    const expected = unsubTokenFor(`project_invite_${projectId}`);
    const valid =
      !!expected &&
      expected.length === token.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    if (!valid) {
      response.status(200).send(ok);
      return;
    }

    try {
      const projectRef = db.doc(`projects/${projectId}`);
      const snap = await projectRef.get();
      const invite = snap.exists
        ? (snap.get("projectInvite") as { emailLower?: string; status?: string } | null)
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
        batch.update(projectRef, {
          "projectInvite.status": "revoked",
          "projectInvite.revokedAt": FieldValue.serverTimestamp(),
          "projectInvite.tokenHash": null,
        });
      }
      await batch.commit();

      logger.info("unsubscribeProjectInvite: unsubscribed", { projectId });
      response.status(200).send(ok);
    } catch (err) {
      logger.error("unsubscribeProjectInvite: failed", { projectId, err });
      response.status(500).send(page("Something went wrong. Please try again later."));
    }
  },
);
