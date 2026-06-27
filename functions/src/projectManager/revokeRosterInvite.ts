import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

const Input = z.object({ inviteId: z.string().min(1).max(128) });

/**
 * Cancel a pending roster invite (e.g. a typo'd email). Owner-only; a no-op if
 * the invite already joined or was revoked. Writes flow through here because the
 * rosterInvites rule denies all client writes.
 */
export const revokeRosterInvite = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");

  const ref = db.collection("rosterInvites").doc(parsed.data.inviteId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Invite not found.");
  if (snap.get("pmId") !== uid) throw new HttpsError("permission-denied", "Not your invite.");

  // Only a pending invite can be cancelled; joined/revoked are terminal.
  if (snap.get("status") === "pending_signup") {
    await ref.update({ status: "revoked", revokedAt: FieldValue.serverTimestamp() });
  }
  return { ok: true };
});
