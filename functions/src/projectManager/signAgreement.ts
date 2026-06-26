import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { SignatureDataUrl, writeSignatureAt } from "../lib/signature";
import { PM_AGREEMENT_VERSION } from "../lib/projectManager";

const Input = z.object({ signatureDataUrl: SignatureDataUrl });

/**
 * A project manager e-signs the current liability agreement. Unlike a sales rep,
 * a PM is ACTIVE from the moment the role is enabled — the agreement does NOT gate
 * the cockpit; it gates MONEY (Stripe Connect onboarding + payouts, via
 * assertPmAgreementSigned). The drawn signature is written server-side (immutable
 * audit artifact) and the signed version recorded on users/{uid}.projectManager.
 * liability. Lazily initialises projectManager on first sign; preserves
 * referralCode / active / createdAt when re-signing a bumped version. Mirrors
 * signSalesAgreement.
 */
export const signPmAgreement = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "projectManager");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const ctx = { fn: "signPmAgreement", uid };

  // Record the signature BEFORE the doc write — never record an agreement without
  // its signature landing. Path mirrors the sales-agreement convention.
  let signaturePath: string;
  try {
    signaturePath = await writeSignatureAt(
      `users/${uid}/signatures/pm-agreement`,
      parsed.data.signatureDataUrl,
    );
  } catch (err) {
    logger.error("signPmAgreement signature upload failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't record your signature. Please try again.");
  }

  const userRef = db.doc(`users/${uid}`);
  const snap = await userRef.get();
  const hasPm = snap.exists && snap.data()?.projectManager != null;

  const liability = {
    version: PM_AGREEMENT_VERSION,
    signedAt: FieldValue.serverTimestamp(),
    signatureStoragePath: signaturePath,
  };

  if (!hasPm) {
    // First sign with no PM state yet (defensive — the role enable normally
    // seeds it): initialise active so the cockpit + payouts gates pass.
    await userRef.set(
      {
        projectManager: {
          referralCode: "",
          active: true,
          liability,
          createdAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
  } else {
    // Re-sign (version bump): deep-merge only liability, preserving the rest.
    await userRef.set({ projectManager: { liability } }, { merge: true });
  }

  logger.info("signPmAgreement recorded", { ...ctx, version: PM_AGREEMENT_VERSION, signaturePath });
  return { ok: true as const, version: PM_AGREEMENT_VERSION };
});
