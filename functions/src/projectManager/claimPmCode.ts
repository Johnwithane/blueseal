import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requirePmActive } from "../lib/projectManager";
import { isValidReferralCode, normalizeReferralCode } from "../lib/referralCode";

const Input = z.object({ code: z.string().trim().min(1).max(40) });

/**
 * A project manager claims (or changes) their vanity recruiting code. Uniqueness
 * is enforced through a pmReferralCodes/{codeLower} registry doc inside a
 * transaction (mirrors claimReferralCode), so two PMs can't grab the same code in
 * a race. The code is mirrored onto users/{uid}.projectManager.referralCode and the
 * previous code's registry doc is freed. Gated by requirePmActive — note the
 * agreement is NOT required to recruit (it gates payout, not the cockpit). Kept
 * separate from the sales rep's referralCodes so the live ?ref= path is untouched.
 */
export const claimPmCode = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "projectManager");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid code.");
  const code = normalizeReferralCode(parsed.data.code);
  if (!isValidReferralCode(code)) {
    throw new HttpsError("invalid-argument", "Use 3-20 letters or numbers.");
  }

  await requirePmActive(uid); // active project manager

  const codeLower = code.toLowerCase();
  const codeRef = db.doc(`pmReferralCodes/${codeLower}`);
  const userRef = db.doc(`users/${uid}`);

  await db.runTransaction(async (tx) => {
    const [codeSnap, userSnap] = await Promise.all([tx.get(codeRef), tx.get(userRef)]);
    if (codeSnap.exists && codeSnap.get("uid") !== uid) {
      throw new HttpsError("already-exists", "That code is taken. Try another.");
    }
    const oldCode = ((userSnap.get("projectManager.referralCode") as string | undefined) ?? "").trim();
    const oldLower = oldCode.toLowerCase();
    if (oldLower && oldLower !== codeLower) {
      tx.delete(db.doc(`pmReferralCodes/${oldLower}`));
    }
    tx.set(codeRef, { uid, code, claimedAt: FieldValue.serverTimestamp() });
    tx.set(userRef, { projectManager: { referralCode: code } }, { merge: true });
  });

  logger.info("claimPmCode claimed", { uid, code });
  return { code };
});
