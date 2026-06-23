import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { deliver } from "../lib/brandedMail";
import { appUrl } from "../lib/notifyAdmins";
import { logAdminAction } from "../lib/audit";

const Input = z.object({ uid: z.string().min(1).max(128) });

const REPLY_TO = process.env.SUPPORT_REPLY_TO || "hello@blueseal.app";

/**
 * Admin-triggered "need a hand finishing your application?" nudge to a
 * tradesperson who signed up but never submitted for vetting. Drives the
 * "Reach out" button on /admin/onboarding.
 *
 * Guards that the target is genuinely an unfinished onboarding (no tradie doc
 * yet, or one still in `draft`) so an admin can't accidentally email someone
 * who's already pending/approved. Records the nudge on the tradie doc (when one
 * exists) so the view can show "nudged X ago" and the admin doesn't double-tap.
 */
export const nudgeOnboarding = onCall(CALLABLE_OPTS, async (req) => {
  const adminUid = requireAdmin(req);
  const { uid } = Input.parse(req.data);

  const [userSnap, tradieSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`tradespeople/${uid}`).get(),
  ]);
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");
  const user = userSnap.data() as { email?: unknown; displayName?: unknown; roles?: unknown };

  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (!roles.includes("tradesperson")) {
    throw new HttpsError("failed-precondition", "User is not a tradesperson.");
  }
  if (tradieSnap.exists) {
    const status = (tradieSnap.data() as { vettingStatus?: string }).vettingStatus;
    if (status && status !== "draft") {
      throw new HttpsError(
        "failed-precondition",
        `Tradesperson is "${status}", not an unfinished signup.`,
      );
    }
  }

  const email = typeof user.email === "string" ? user.email : "";
  if (!email) throw new HttpsError("failed-precondition", "No email on file for this user.");
  const firstName =
    typeof user.displayName === "string" && user.displayName.trim()
      ? user.displayName.trim().split(/\s+/)[0]
      : "there";

  await deliver({
    to: email,
    replyTo: REPLY_TO,
    subject: "Need a hand finishing your Blue Seal application?",
    title: "Let's finish setting up your profile",
    bodyLines: [
      `Hi ${firstName},`,
      "We noticed you started signing up as a tradesperson on Blue Seal but haven't submitted your profile for review yet.",
      "Once you finish and we verify your certifications and ID, your profile goes live and clients in your area can find you and send you job requests.",
      "If you got stuck or have any questions, just reply to this email and we'll help you get set up.",
    ],
    ctaLabel: "Finish my application",
    ctaUrl: appUrl("/onboarding"),
  });

  // Record the nudge so /admin/onboarding can surface "nudged X ago" and the
  // admin doesn't re-ping the same person. Only when a tradie doc exists
  // (signed-up-but-never-opened-onboarding has no doc to stamp).
  if (tradieSnap.exists) {
    await tradieSnap.ref.update({
      onboardingNudgedAt: FieldValue.serverTimestamp(),
      onboardingNudgeCount: FieldValue.increment(1),
    });
  }

  await logAdminAction({
    actorUid: adminUid,
    action: "onboarding_nudge_sent",
    targetType: "tradesperson",
    targetId: uid,
  });
  logger.info("onboarding nudge sent", { adminUid, uid });

  return { ok: true, sentTo: email };
});
