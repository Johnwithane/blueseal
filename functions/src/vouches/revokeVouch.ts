import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

const Input = z.object({ vouchId: z.string().min(1).max(128) });

/**
 * Voucher (fromUserId) or vouchee (toUserId) deletes a vouch outright.
 *   - Voucher: changed their mind, or invited the wrong email.
 *   - Vouchee: wants the chip off their profile after previously accepting.
 *
 * Hard delete (not a status flip) so a future re-vouch from the same
 * voucher passes the dedupe check without admin intervention.
 */
export const revokeVouch = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.message);
  }
  const { vouchId } = parsed.data;

  const ref = db.doc(`vouches/${vouchId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Recommendation not found.");
  const data = snap.data() as { fromUserId: string; toUserId: string | null };

  if (data.fromUserId !== uid && data.toUserId !== uid) {
    throw new HttpsError("permission-denied", "Not your recommendation.");
  }

  await ref.delete();
  logger.info("revokeVouch", { uid, vouchId });
  return { ok: true };
});
