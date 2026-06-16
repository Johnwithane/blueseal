import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { InsuranceWaiverDoc, WithId } from "@/firebase/interfaces";

/**
 * The assigned tradesperson signs the per-job "I'm working without insurance"
 * waiver. Required (and enforced by clockIn) before an uninsured tradesperson
 * can start work. `signatureDataUrl` is the finger-drawn signature (WebP/PNG
 * data URL); the server decodes + stores it as the immutable record.
 */
export async function signUninsuredWaiver(
  jobId: string,
  signatureDataUrl: string,
): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string; signatureDataUrl: string }, { ok: true }>(
    functions,
    "signUninsuredWaiver",
  );
  const res = await fn({ jobId, signatureDataUrl });
  return res.data;
}

/**
 * Read the per-job uninsured-work waiver, if any. Keyed by jobId; readable by
 * both job parties + admin. Returns null when no waiver exists (the tradesperson
 * is/was insured for this job, or hasn't been recorded). Used by JobDetailView
 * to decide whether the tradesperson still needs to sign before clocking in.
 */
export async function getInsuranceWaiver(
  jobId: string,
): Promise<WithId<InsuranceWaiverDoc> | null> {
  const snap = await getDoc(doc(db, "insuranceWaivers", jobId));
  return snap.exists() ? { id: snap.id, ...(snap.data() as InsuranceWaiverDoc) } : null;
}
