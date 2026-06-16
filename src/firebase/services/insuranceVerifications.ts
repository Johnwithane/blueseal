import { Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { InsuranceVerificationDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const insuranceRef = (uid: string) =>
  doc(db, "insuranceVerifications", uid).withConverter(
    typedConverter<InsuranceVerificationDoc>(),
  );

export interface SubmitInsuranceInput {
  fileUrl: string;
  insurer: string;
  policyNumber: string;
  coverageAmount: number; // cents
  expiresAt: Date;
  // The tradesperson's declaration: is Blue Seal named as an additional insured
  // on this policy? When false, they must then sign the liability release
  // (signInsuranceLiabilityRelease) before an admin will approve.
  blueSealAdditionalInsured: boolean;
}

export async function submitInsurance(uid: string, input: SubmitInsuranceInput): Promise<void> {
  // setDoc fully overwrites — a fresh submission deliberately clears any prior
  // liabilityRelease / admin confirmation so review starts clean.
  await setDoc(insuranceRef(uid), {
    fileUrl: input.fileUrl,
    insurer: input.insurer.trim(),
    policyNumber: input.policyNumber.trim(),
    coverageAmount: input.coverageAmount,
    expiresAt: Timestamp.fromDate(input.expiresAt),
    status: "pending",
    submittedAt: serverTimestamp() as never,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    blueSealAdditionalInsured: input.blueSealAdditionalInsured,
    liabilityRelease: null,
    additionalInsuredConfirmedBy: null,
    additionalInsuredConfirmedAt: null,
  });
}

/**
 * Tradesperson signs the liability release when their own policy does NOT name
 * Blue Seal as an additional insured. Server-written (signature stored
 * server-side) — call after submitInsurance with blueSealAdditionalInsured:false.
 */
export async function signInsuranceLiabilityRelease(
  signatureDataUrl: string,
): Promise<{ ok: true }> {
  const fn = httpsCallable<{ signatureDataUrl: string }, { ok: true }>(
    functions,
    "signInsuranceLiabilityRelease",
  );
  const res = await fn({ signatureDataUrl });
  return res.data;
}

export async function getInsurance(
  uid: string,
): Promise<WithId<InsuranceVerificationDoc> | null> {
  const snap = await getDoc(insuranceRef(uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Owner-only edit of an in-review submission. Lets the tradesperson fix a
// typo (insurer name, policy number, coverage, expiry) without re-uploading
// the certificate file. Rules require status to stay 'pending' and disallow
// touching reviewedBy / reviewedAt — both are enforced server-side, and this
// patch deliberately omits both fields.
export interface UpdateInsuranceInput {
  insurer: string;
  policyNumber: string;
  coverageAmount: number; // cents
  expiresAt: Date;
}

export async function updateInsurance(
  uid: string,
  input: UpdateInsuranceInput,
): Promise<void> {
  await updateDoc(doc(db, "insuranceVerifications", uid), {
    insurer: input.insurer.trim(),
    policyNumber: input.policyNumber.trim(),
    coverageAmount: input.coverageAmount,
    expiresAt: Timestamp.fromDate(input.expiresAt),
  });
}

export async function approveInsurance(
  uid: string,
  adminUid: string,
  opts?: { additionalInsuredConfirmed?: boolean },
): Promise<void> {
  await updateDoc(doc(db, "insuranceVerifications", uid), {
    status: "approved",
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp(),
    rejectionReason: null,
    // Stamp the admin's confirmation that the certificate names Blue Seal as an
    // additional insured (only set when the tradesperson declared it does).
    ...(opts?.additionalInsuredConfirmed
      ? {
          additionalInsuredConfirmedBy: adminUid,
          additionalInsuredConfirmedAt: serverTimestamp(),
        }
      : {}),
  });
}

export async function rejectInsurance(
  uid: string,
  adminUid: string,
  reason: string,
): Promise<void> {
  await updateDoc(doc(db, "insuranceVerifications", uid), {
    status: "rejected",
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp(),
    rejectionReason: reason,
  });
}
