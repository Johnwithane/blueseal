import { Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
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
}

export async function submitInsurance(uid: string, input: SubmitInsuranceInput): Promise<void> {
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
  });
}

export async function getInsurance(
  uid: string,
): Promise<WithId<InsuranceVerificationDoc> | null> {
  const snap = await getDoc(insuranceRef(uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function approveInsurance(uid: string, adminUid: string): Promise<void> {
  await updateDoc(doc(db, "insuranceVerifications", uid), {
    status: "approved",
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp(),
    rejectionReason: null,
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
