import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requireRepActive } from "../lib/salesRep";
import { isValidReferralCode, normalizeReferralCode } from "../lib/referralCode";

const Input = z.object({ code: z.string().trim().min(1).max(40) });

/**
 * A sales rep claims (or changes) their vanity referral code. Uniqueness is
 * enforced through a referralCodes/{codeLower} registry doc inside a transaction
 * (mirrors claimProfileSlug), so two reps can't grab the same code in a race.
 * The code is mirrored onto users/{uid}.salesRep.referralCode and the previous
 * code's registry doc is freed. Gated by requireRepActive — a rep must have
 * signed the current agreement and be active before they can hand out a code.
 */
export const claimReferralCode = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "sales");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid code.");
  const code = normalizeReferralCode(parsed.data.code);
  if (!isValidReferralCode(code)) {
    throw new HttpsError("invalid-argument", "Use 3-20 letters or numbers.");
  }

  await requireRepActive(uid); // signed current agreement + active

  const codeLower = code.toLowerCase();
  const codeRef = db.doc(`referralCodes/${codeLower}`);
  const userRef = db.doc(`users/${uid}`);

  await db.runTransaction(async (tx) => {
    const [codeSnap, userSnap] = await Promise.all([tx.get(codeRef), tx.get(userRef)]);
    if (codeSnap.exists && codeSnap.get("uid") !== uid) {
      throw new HttpsError("already-exists", "That code is taken. Try another.");
    }
    const oldCode = ((userSnap.get("salesRep.referralCode") as string | undefined) ?? "").trim();
    const oldLower = oldCode.toLowerCase();
    if (oldLower && oldLower !== codeLower) {
      tx.delete(db.doc(`referralCodes/${oldLower}`));
    }
    tx.set(codeRef, { uid, code, claimedAt: FieldValue.serverTimestamp() });
    tx.set(userRef, { salesRep: { referralCode: code } }, { merge: true });
  });

  logger.info("claimReferralCode claimed", { uid, code });
  return { code };
});
