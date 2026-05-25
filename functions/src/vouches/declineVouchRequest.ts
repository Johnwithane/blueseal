import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

const Input = z.object({ vouchId: z.string().min(1).max(128) });

/**
 * Vouchee declines a pending vouch addressed to them. Doc stays so the
 * voucher can see the outcome (and so a future re-vouch from the same
 * person triggers the dedupe check). No notification to the voucher —
 * a polite decline is private.
 */
export const declineVouchRequest = onCall(
  { enforceAppCheck: false },
  async (req) => {
    const uid = requireAuth(req);
    const parsed = Input.safeParse(req.data);
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", parsed.error.message);
    }
    const { vouchId } = parsed.data;

    const ref = db.doc(`vouches/${vouchId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Recommendation not found.");
    const data = snap.data() as { toUserId: string | null; status: string };

    if (data.toUserId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "This recommendation isn't addressed to you.",
      );
    }
    if (data.status !== "pending_acceptance") {
      throw new HttpsError(
        "failed-precondition",
        `Recommendation is ${data.status}, not pending.`,
      );
    }

    await ref.update({
      status: "declined",
      respondedAt: FieldValue.serverTimestamp(),
    });

    logger.info("declineVouchRequest", { uid, vouchId });
    return { ok: true };
  },
);
