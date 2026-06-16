import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { SignatureDataUrl, writeUninsuredWaiverSignature } from "../lib/signature";
import { isTradieInsured, UNINSURED_DISCLOSURE_VERSION } from "../lib/insurance";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  signatureDataUrl: SignatureDataUrl,
});

interface JobLike {
  tradespersonId?: string;
  clientId?: string | null;
  status?: string;
}

interface TradieLike {
  insuranceVerified?: boolean | null;
  insuranceExpiresAt?: Timestamp | null;
}

/**
 * The assigned tradesperson signs the "I'm working without insurance" waiver
 * for a job. Required (and enforced by clockIn) before an uninsured tradesperson
 * can start work — the drawn signature is the record that they chose to proceed
 * uninsured and accepted sole liability + released Blue Seal.
 *
 * Writes/merges insuranceWaivers/{jobId}.tradesperson. The client's matching
 * acknowledgment (if the tradie was already uninsured at acceptance) lives in
 * the same doc's `client` part, written by the accept callables — so we
 * create-or-merge to avoid clobbering it.
 */
export const signUninsuredWaiver = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, signatureDataUrl } = parsed.data;
  const ctx = { fn: "signUninsuredWaiver", uid, jobId };

  const jobRef = db.doc(`jobs/${jobId}`);
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const [jobSnap, tradieSnap] = await Promise.all([jobRef.get(), tradieRef.get()]);

  if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
  const job = jobSnap.data() as JobLike;
  if (job.tradespersonId !== uid) {
    throw new HttpsError("permission-denied", "Only the assigned tradesperson can sign this waiver.");
  }
  // No waiver needed once they're actually insured — surface it so the UI can
  // drop the gate and refresh rather than recording a pointless waiver.
  if (isTradieInsured(tradieSnap.data() as TradieLike | undefined)) {
    throw new HttpsError("failed-precondition", "You're insured for this job — no waiver is required.");
  }

  // Record the signature BEFORE the doc write (same discipline as the accept
  // callables): never record a waiver without its signature landing.
  let signaturePath: string;
  try {
    signaturePath = await writeUninsuredWaiverSignature(jobId, signatureDataUrl);
  } catch (err) {
    logger.error("signUninsuredWaiver signature upload failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't record your signature. Please try again.");
  }

  const waiverRef = db.doc(`insuranceWaivers/${jobId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(waiverRef);
    // Only stamp the create-time + identity fields on first write so a prior
    // client acknowledgment (and its createdAt) is preserved.
    const base = snap.exists
      ? {}
      : {
          jobId,
          clientId: job.clientId ?? null,
          tradespersonId: uid,
          disclosureVersion: UNINSURED_DISCLOSURE_VERSION,
          reason: "no_liability_insurance",
          client: null,
          createdAt: FieldValue.serverTimestamp(),
        };
    tx.set(
      waiverRef,
      {
        ...base,
        tradesperson: {
          acknowledgedAt: FieldValue.serverTimestamp(),
          byUid: uid,
          signatureStoragePath: signaturePath,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  logger.info("signUninsuredWaiver recorded", { ...ctx, signaturePath });
  return { ok: true };
});
