import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { enqueueMail } from "../lib/mail";

const Input = z.object({
  reason: z.string().trim().max(2000).optional(),
});

/**
 * PIPEDA: user requests deletion of their own account. We soft-delete now
 * (set deletedAt) so sign-in is blocked + tradies disappear from search,
 * then schedule the actual data wipe via scheduledHardDelete after a
 * 30-day grace period. The grace window gives the user time to recover
 * via support if it was accidental — there's no self-serve un-delete to
 * keep the path deliberate.
 *
 * Returns success even when the user doc is already deleted (idempotent).
 */
export const requestAccountDeletion = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { reason } = parsed.data;
  const ctx = { fn: "requestAccountDeletion", uid };

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    logger.warn("requestAccountDeletion: user doc missing", ctx);
    return { ok: true };
  }
  const user = userSnap.data() as { email?: string; displayName?: string; deletedAt?: unknown };
  if (user.deletedAt) {
    logger.info("requestAccountDeletion: already pending", ctx);
    return { ok: true };
  }

  // Mark for deletion. Server timestamp so the 30-day grace clock starts
  // from the server's wall clock, not the client's (which could be skewed).
  await userRef.update({ deletedAt: FieldValue.serverTimestamp() });

  // Hide the tradesperson profile immediately so they stop appearing in
  // search during the grace period. Doesn't delete the doc — that happens
  // in scheduledHardDelete.
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const tradieSnap = await tradieRef.get();
  if (tradieSnap.exists) {
    await tradieRef.update({ isVisible: false });
  }

  // Confirmation email so the user has a record + can recognize an
  // accidental click. Mentions the grace window + the support email so
  // recovery is obvious.
  if (user.email) {
    await enqueueMail({
      to: user.email,
      subject: "Your Blue Seal account is scheduled for deletion",
      text:
        `Hi ${user.displayName ?? "there"},\n\n` +
        "You requested deletion of your Blue Seal account.\n\n" +
        "Your profile is now hidden from search and you've been signed out. " +
        "We'll wipe your account data permanently in 30 days.\n\n" +
        "If this was a mistake, reply to this email within 30 days and we'll restore your account.\n\n" +
        "— Blue Seal",
    });
  }

  await logAdminAction({
    actorUid: uid,
    action: "requestAccountDeletion",
    targetType: "user",
    targetId: uid,
    reason: reason ?? null,
  });

  logger.info("requestAccountDeletion: marked", ctx);
  return { ok: true };
});
