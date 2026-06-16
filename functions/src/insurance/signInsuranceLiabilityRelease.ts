import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { SignatureDataUrl, writeSignatureAt } from "../lib/signature";
import { INSURANCE_RELEASE_VERSION } from "../lib/insurance";

const Input = z.object({
  signatureDataUrl: SignatureDataUrl,
});

interface InsuranceLike {
  status?: string;
  blueSealAdditionalInsured?: boolean;
}

/**
 * A tradesperson who has uploaded their OWN insurance policy that does NOT name
 * Blue Seal as an additional insured signs a liability release in Blue Seal's
 * favour. The drawn signature is written server-side (immutable audit artifact)
 * and the release is recorded on insuranceVerifications/{uid} so an admin can
 * approve the submission knowing Blue Seal is protected.
 *
 * Server-written so the release record + signature can't be forged client-side.
 */
export const signInsuranceLiabilityRelease = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { signatureDataUrl } = parsed.data;
  const ctx = { fn: "signInsuranceLiabilityRelease", uid };

  const insuranceRef = db.doc(`insuranceVerifications/${uid}`);
  const snap = await insuranceRef.get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Upload your insurance details first.");
  }
  const ins = snap.data() as InsuranceLike;
  // Only meaningful while the submission is in review. Once approved/rejected
  // the tradesperson re-submits (which resets the doc) before re-signing.
  if (ins.status !== "pending") {
    throw new HttpsError(
      "failed-precondition",
      "This submission isn't open for a release right now. Re-submit your certificate first.",
    );
  }

  // Record the signature BEFORE the doc write — never record a release without
  // its signature landing. Path mirrors the per-job waiver convention.
  let signaturePath: string;
  try {
    signaturePath = await writeSignatureAt(
      `tradespeople/${uid}/signatures/insurance-liability-release`,
      signatureDataUrl,
    );
  } catch (err) {
    logger.error("signInsuranceLiabilityRelease signature upload failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't record your signature. Please try again.");
  }

  await insuranceRef.set(
    {
      // Signing the release IS the "Blue Seal is not named" declaration.
      blueSealAdditionalInsured: false,
      liabilityRelease: {
        signedAt: FieldValue.serverTimestamp(),
        version: INSURANCE_RELEASE_VERSION,
        signatureStoragePath: signaturePath,
      },
    },
    { merge: true },
  );

  logger.info("signInsuranceLiabilityRelease recorded", { ...ctx, signaturePath });
  return { ok: true };
});
