import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";
import { loadVoucheeDisplay } from "./helpers";

/**
 * When a /users/{uid} doc is created, claim any pending_signup vouches
 * addressed to that user's email. Per design decision: completing signup
 * via the invited email counts as accepting — no extra confirm step.
 *
 * - Sets toUserId, status=accepted, refreshes denorm display fields.
 * - Clears toEmail so the address isn't kept around once the link exists.
 * - Notifies each voucher that their invite is live.
 *
 * Idempotent: pending_signup is the trigger condition, so a re-run of this
 * function on the same user finds nothing.
 */
export const linkPendingVouchesOnSignup = onDocumentCreated(
  "users/{uid}",
  async (event) => {
    const uid = event.params.uid;
    const data = event.data?.data() as { email?: string } | undefined;
    const rawEmail = typeof data?.email === "string" ? data.email : null;
    if (!rawEmail) {
      logger.info("linkPendingVouchesOnSignup: no email on user doc", { uid });
      return;
    }
    const email = rawEmail.trim().toLowerCase();

    const pendingSnap = await db
      .collection("vouches")
      .where("toEmail", "==", email)
      .where("status", "==", "pending_signup")
      .get();

    if (pendingSnap.empty) return;

    // Load the new user's display info once for the denorm refresh below.
    const display = await loadVoucheeDisplay(uid);

    // Batch the writes so all vouches link atomically; notify out-of-band
    // (notify writes are not idempotent and don't belong in a batch).
    const batch = db.batch();
    for (const docSnap of pendingSnap.docs) {
      batch.update(docSnap.ref, {
        toUserId: uid,
        toDisplayName: display.displayName,
        toPhotoURL: display.photoURL,
        toPrimaryTrade: display.primaryTrade,
        toEmail: null,
        status: "accepted",
        respondedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    for (const docSnap of pendingSnap.docs) {
      const vouch = docSnap.data() as {
        fromUserId: string;
        fromDisplayName: string;
      };
      try {
        await notify({
          userId: vouch.fromUserId,
          type: "recommendation_accepted",
          title: `${display.displayName} just signed up`,
          body: "Your recommendation is now live on both profiles.",
          link: `/tradies/${vouch.fromUserId}`,
          actorUid: uid,
          recipientRole: "tradesperson",
          priority: "normal",
        });
      } catch (err) {
        logger.error("linkPendingVouchesOnSignup: notify failed", {
          uid,
          vouchId: docSnap.id,
          err,
        });
      }
    }

    logger.info("linkPendingVouchesOnSignup: claimed invites", {
      uid,
      email,
      count: pendingSnap.size,
    });
  },
);
