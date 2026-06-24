import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { SignatureDataUrl, writeSignatureAt } from "../lib/signature";
import { REP_AGREEMENT_VERSION } from "../lib/salesRep";

const Input = z.object({ signatureDataUrl: SignatureDataUrl });

/**
 * A sales rep e-signs the current liability agreement. The drawn signature is
 * written server-side (immutable audit artifact) and the signed version is
 * recorded on users/{uid}.salesRep.liability. A rep is inert until this lands —
 * the referral-code + vetting callables call requireRepActive, which checks the
 * recorded version matches REP_AGREEMENT_VERSION. Lazily initialises salesRep on
 * first sign; preserves referralCode/active when re-signing a bumped version.
 */
export const signSalesAgreement = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "sales");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const ctx = { fn: "signSalesAgreement", uid };

  // Record the signature BEFORE the doc write — never record an agreement
  // without its signature landing. Path mirrors the insurance-release convention.
  let signaturePath: string;
  try {
    signaturePath = await writeSignatureAt(
      `users/${uid}/signatures/sales-agreement`,
      parsed.data.signatureDataUrl,
    );
  } catch (err) {
    logger.error("signSalesAgreement signature upload failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't record your signature. Please try again.");
  }

  const userRef = db.doc(`users/${uid}`);
  const snap = await userRef.get();
  const hasRep = snap.exists && snap.data()?.salesRep != null;

  const liability = {
    version: REP_AGREEMENT_VERSION,
    signedAt: FieldValue.serverTimestamp(),
    signatureStoragePath: signaturePath,
  };

  if (!hasRep) {
    // First sign: initialise the rep. Deep-merge so we never clobber another
    // server-managed user field.
    await userRef.set(
      { salesRep: { referralCode: "", active: true, liability, createdAt: FieldValue.serverTimestamp() } },
      { merge: true },
    );
  } else {
    // Re-sign (version bump): deep-merge updates only liability, preserving the
    // rep's referralCode / active / createdAt.
    await userRef.set({ salesRep: { liability } }, { merge: true });
  }

  logger.info("signSalesAgreement recorded", { ...ctx, version: REP_AGREEMENT_VERSION, signaturePath });
  return { ok: true as const, version: REP_AGREEMENT_VERSION };
});
