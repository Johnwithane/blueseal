import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requireVisibleTradie, rateLimitKey } from "./helpers";
import { loadVoucherDisplay } from "../vouches/helpers";
import { notify } from "../lib/notify";

// Mirror of src/validation/schemas.ts → sendJobReferralSchema. Duplicated so
// the callable's input contract is locked in even if the client-side schema
// is later edited in isolation.
const Input = z.object({
  postId: z.string().min(1).max(128),
  toUserId: z.string().min(1).max(128),
  message: z.string().trim().max(300).optional(),
});

const DAILY_REFERRAL_CAP = 20;

/**
 * Tradesperson refers an open job post to another verified tradesperson
 * whose trade matches the post (e.g. a plumber browsing "Any trade" spots an
 * electrician job and sends it to an electrician they know).
 *
 * One referral per (post, referrer, recipient) — enforced by the
 * deterministic doc id `${postId}_${fromUid}_${toUid}`, so dedupe is a
 * transactional exists-check rather than a query (mirrors the
 * applications/{tradieId} doc-id-as-constraint precedent).
 *
 * Deliberately NOT enforced server-side:
 *  - Recipient distance from the job. The picker UI only offers tradies whose
 *    service radius covers the post, but a referrer who knows someone would
 *    travel shouldn't be hard-blocked; the daily cap bounds abuse.
 *  - "Recipient already applied". Checking would leak bid-blind application
 *    existence to the referrer. A redundant referral is harmless and can't
 *    produce a false conversion — re-applying is blocked, so appliedAt only
 *    ever stamps on a genuine first application.
 */
export const sendJobReferral = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  await requireVisibleTradie(uid);

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { postId, toUserId, message } = parsed.data;
  const ctx = { fn: "sendJobReferral", uid, postId, toUserId };

  if (toUserId === uid) {
    throw new HttpsError("invalid-argument", "You can't refer a job to yourself.");
  }

  // Display snapshots load outside the transaction — they're denormalised
  // hints, not invariants the transaction must hold.
  const [fromDisplay, toUserSnap] = await Promise.all([
    loadVoucherDisplay(uid),
    db.doc(`users/${toUserId}`).get(),
  ]);
  const toUser = toUserSnap.data() as
    | { displayName?: string; photoURL?: string | null }
    | undefined;

  const postRef = db.doc(`jobPosts/${postId}`);
  const toTradieRef = db.doc(`tradespeople/${toUserId}`);
  const referralRef = db.doc(`referrals/${postId}_${uid}_${toUserId}`);
  const rateRef = db.doc(`rateLimits/${rateLimitKey(uid, "sendReferral")}`);

  let postTitle = "";
  let postCity = "";

  try {
    await db.runTransaction(async (tx) => {
      const [postSnap, toTradieSnap, referralSnap, rateSnap] = await Promise.all([
        tx.get(postRef),
        tx.get(toTradieRef),
        tx.get(referralRef),
        tx.get(rateRef),
      ]);

      if (!postSnap.exists) throw new HttpsError("not-found", "Job post not found.");
      const post = postSnap.data() as {
        status: string;
        clientId: string;
        trade: string;
        title: string;
        addressPublic?: { city?: string };
        expiresAt?: Timestamp;
      };
      if (post.status !== "open") {
        throw new HttpsError("failed-precondition", "This job post is no longer open.");
      }
      if (post.expiresAt && post.expiresAt.toMillis() < Date.now()) {
        throw new HttpsError("failed-precondition", "This job post has expired.");
      }
      if (post.clientId === uid) {
        throw new HttpsError("permission-denied", "You can't refer your own job post.");
      }
      if (post.clientId === toUserId) {
        throw new HttpsError("invalid-argument", "You can't refer a post to its owner.");
      }

      // One generic message for every recipient-eligibility failure so the
      // response doesn't leak which check failed (exists / visible / trade).
      const toTradie = toTradieSnap.data() as
        | { isVisible?: boolean; trades?: string[] }
        | undefined;
      if (
        !toTradieSnap.exists ||
        toTradie?.isVisible !== true ||
        !toTradie.trades?.includes(post.trade)
      ) {
        throw new HttpsError(
          "failed-precondition",
          "That tradesperson can't receive this referral.",
        );
      }

      if (referralSnap.exists) {
        throw new HttpsError("already-exists", "You've already referred this job to them.");
      }

      const rateCount = (rateSnap.data() as { count?: number } | undefined)?.count ?? 0;
      if (rateCount >= DAILY_REFERRAL_CAP) {
        throw new HttpsError(
          "resource-exhausted",
          `Daily referral limit reached (${DAILY_REFERRAL_CAP}). Try again tomorrow.`,
        );
      }

      postTitle = post.title;
      postCity = post.addressPublic?.city ?? "";

      tx.set(referralRef, {
        postId,
        postTitle: post.title,
        postTrade: post.trade,
        postCity,
        fromUserId: uid,
        ...fromDisplay,
        toUserId,
        toDisplayName: (toUser?.displayName ?? "").trim() || "Tradesperson",
        toPhotoURL: toUser?.photoURL ?? null,
        message: message ?? "",
        createdAt: FieldValue.serverTimestamp(),
        appliedAt: null,
      });
      tx.set(
        rateRef,
        {
          uid,
          action: "sendReferral",
          count: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    await notify({
      userId: toUserId,
      type: "job_referred",
      title: `${fromDisplay.fromDisplayName} referred a job to you`,
      body: message
        ? `"${postTitle}"${postCity ? ` in ${postCity}` : ""} — "${message}"`
        : `"${postTitle}"${postCity ? ` in ${postCity}` : ""} — open the post to apply.`,
      link: `/jobs/posted/${postId}`,
      actorUid: uid,
      recipientRole: "tradesperson",
      priority: "normal",
    });

    logger.info("sendJobReferral success", ctx);
    return { referralId: referralRef.id };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("sendJobReferral failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't send referral.");
  }
});
