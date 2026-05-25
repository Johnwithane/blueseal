import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { notify } from "../lib/notify";
import { loadVoucheeDisplay } from "./helpers";

const Input = z.object({ vouchId: z.string().min(1).max(128) });

/**
 * Vouchee accepts a pending vouch addressed to them. Refreshes the
 * denormalised display fields (their displayName/photo may have changed
 * since the voucher hit Send) so the public chip matches the live profile.
 */
export const acceptVouchRequest = onCall(
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
    if (!snap.exists) throw new HttpsError("not-found", "Vouch not found.");
    const data = snap.data() as {
      fromUserId: string;
      fromDisplayName: string;
      toUserId: string | null;
      status: string;
    };

    if (data.toUserId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "This vouch isn't addressed to you.",
      );
    }
    if (data.status !== "pending_acceptance") {
      throw new HttpsError(
        "failed-precondition",
        `Vouch is ${data.status}, not pending.`,
      );
    }

    const display = await loadVoucheeDisplay(uid);

    await ref.update({
      status: "accepted",
      respondedAt: FieldValue.serverTimestamp(),
      // Refresh denorm in case the vouchee renamed / changed photo since
      // the voucher sent the request.
      toDisplayName: display.displayName,
      toPhotoURL: display.photoURL,
      toPrimaryTrade: display.primaryTrade,
    });

    await notify({
      userId: data.fromUserId,
      type: "vouch_accepted",
      title: `${display.displayName} accepted your vouch`,
      body: "It's now visible on both your profiles.",
      link: `/tradies/${data.fromUserId}`,
      actorUid: uid,
      recipientRole: "tradesperson",
      priority: "normal",
    });

    logger.info("acceptVouchRequest", { uid, vouchId });
    return { ok: true };
  },
);
