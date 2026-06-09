import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { adminAuth, db, storage } from "../lib/admin";
import { logAdminAction } from "../lib/audit";

const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * PIPEDA hard-delete sweep. Runs daily at 03:00 UTC; finds users whose
 * deletedAt is older than the grace period and wipes their personal data:
 *
 *   - users/{uid}                    (deleted)
 *   - tradespeople/{uid}             (deleted)
 *   - certifications/{*}             (where tradespersonId === uid)
 *   - idVerifications/{uid}          (deleted)
 *   - insuranceVerifications/{uid}   (deleted)
 *   - wsibVerifications/{uid}        (deleted)
 *   - bookings/{*}                   (where tradespersonId === uid)
 *   - notifications/{*}              (where userId === uid)
 *   - Storage: /tradespeople/{uid}/* + /users/{uid}/*
 *   - Firebase Auth user             (deleted)
 *
 * Shared records — jobs, chats, chat messages, public reviews, client
 * reviews, invoices, applications — are intentionally kept. They belong
 * to BOTH parties; deleting them would erase the counterparty's history.
 * Anonymization of denormalized fields (displayName showing as
 * "Deleted user") relies on the UI's null-handling, since the user doc
 * is gone and reads of the deleted user's name will return null. The
 * audit log is also kept (regulatory record).
 *
 * Processes up to 25 users per run to stay well inside the 9-minute
 * scheduler timeout even on slow days.
 */
export const scheduledHardDelete = onSchedule("0 3 * * *", async () => {
  const cutoff = Timestamp.fromMillis(Date.now() - GRACE_PERIOD_MS);
  const ctx = { fn: "scheduledHardDelete", cutoff: cutoff.toDate().toISOString() };
  logger.info("scheduledHardDelete: starting sweep", ctx);

  const dueSnap = await db
    .collection("users")
    .where("deletedAt", "<=", cutoff)
    .limit(25)
    .get();

  if (dueSnap.empty) {
    logger.info("scheduledHardDelete: no accounts due", ctx);
    return;
  }

  for (const userDoc of dueSnap.docs) {
    const uid = userDoc.id;
    const userCtx = { ...ctx, uid };
    try {
      await hardDeleteOne(uid);
      await logAdminAction({
        actorUid: "system:scheduledHardDelete",
        action: "hardDeleteAccount",
        targetType: "user",
        targetId: uid,
      });
      logger.info("scheduledHardDelete: wiped account", userCtx);
    } catch (err) {
      // Don't throw — one bad user shouldn't block the rest of the sweep.
      // The user stays in the queue and the next run retries.
      logger.error("scheduledHardDelete: failed to wipe; will retry next run", {
        ...userCtx,
        err,
      });
    }
  }
});

async function hardDeleteOne(uid: string): Promise<void> {
  // Per-user Firestore docs (single-doc per uid).
  await Promise.all([
    db.doc(`tradespeople/${uid}`).delete().catch(() => undefined),
    db.doc(`idVerifications/${uid}`).delete().catch(() => undefined),
    db.doc(`insuranceVerifications/${uid}`).delete().catch(() => undefined),
    db.doc(`wsibVerifications/${uid}`).delete().catch(() => undefined),
  ]);

  // Collections that hold many docs for the user. Delete in batches.
  await deleteWhere("certifications", "tradespersonId", uid);
  await deleteWhere("bookings", "tradespersonId", uid);
  await deleteWhere("notifications", "userId", uid);

  // Storage trees. Failure to delete a tree is non-fatal — the file lives
  // under owner-scoped rules, so it's still not publicly accessible.
  await Promise.all([
    storage.bucket().deleteFiles({ prefix: `tradespeople/${uid}/` }).catch(() => undefined),
    storage.bucket().deleteFiles({ prefix: `users/${uid}/` }).catch(() => undefined),
  ]);

  // Delete the Firebase Auth user BEFORE the users doc. If this fails for any
  // reason other than the user already being gone, throw so we DON'T delete
  // the users doc: deletedAt stays set, the sweep query still matches, and the
  // next run retries. Deleting the doc while the Auth record survives would
  // strand a sign-in-able account with no profile — which applyAuthState's
  // self-heal would resurrect as a fresh user, re-introducing the exact
  // personal data this sweep must erase. (A swallowed failure here previously
  // left that orphan silently and the doc-gone state stopped the retry.)
  try {
    await adminAuth.deleteUser(uid);
  } catch (err) {
    const code = (err as { code?: string }).code;
    // Already deleted by a prior partial run — fall through to clean up the doc.
    if (code !== "auth/user-not-found") throw err;
  }

  // User doc last so the scheduled sweep query no longer matches this uid.
  await db.doc(`users/${uid}`).delete();
}

async function deleteWhere(
  col: string,
  field: string,
  value: string,
): Promise<void> {
  while (true) {
    const snap = await db.collection(col).where(field, "==", value).limit(400).get();
    if (snap.empty) return;
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    if (snap.size < 400) return;
  }
}
