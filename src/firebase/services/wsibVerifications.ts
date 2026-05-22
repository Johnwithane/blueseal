import { Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import type { CanadaProvince, WithId, WsibVerificationDoc } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const wsibRef = (uid: string) =>
  doc(db, "wsibVerifications", uid).withConverter(typedConverter<WsibVerificationDoc>());

export interface SubmitWsibInput {
  fileUrl: string;
  province: CanadaProvince;
  clearanceNumber: string;
  expiresAt: Date;
}

export async function submitWsib(uid: string, input: SubmitWsibInput): Promise<void> {
  await setDoc(wsibRef(uid), {
    fileUrl: input.fileUrl,
    province: input.province,
    clearanceNumber: input.clearanceNumber.trim(),
    expiresAt: Timestamp.fromDate(input.expiresAt),
    status: "pending",
    submittedAt: serverTimestamp() as never,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
  });
}

export async function getWsib(uid: string): Promise<WithId<WsibVerificationDoc> | null> {
  const snap = await getDoc(wsibRef(uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Owner-only edit of an in-review submission. Same shape as updateInsurance:
// fix typos on a pending doc without re-uploading the file. Rules require
// status to stay 'pending' and disallow touching reviewedBy / reviewedAt.
export interface UpdateWsibInput {
  province: CanadaProvince;
  clearanceNumber: string;
  expiresAt: Date;
}

export async function updateWsib(uid: string, input: UpdateWsibInput): Promise<void> {
  await updateDoc(doc(db, "wsibVerifications", uid), {
    province: input.province,
    clearanceNumber: input.clearanceNumber.trim(),
    expiresAt: Timestamp.fromDate(input.expiresAt),
  });
}

export async function approveWsib(uid: string, adminUid: string): Promise<void> {
  await updateDoc(doc(db, "wsibVerifications", uid), {
    status: "approved",
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp(),
    rejectionReason: null,
  });
}

export async function rejectWsib(
  uid: string,
  adminUid: string,
  reason: string,
): Promise<void> {
  await updateDoc(doc(db, "wsibVerifications", uid), {
    status: "rejected",
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp(),
    rejectionReason: reason,
  });
}
