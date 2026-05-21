import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import type { IdDocType, IdVerificationDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const idRef = (uid: string) =>
  doc(db, "idVerifications", uid).withConverter(typedConverter<IdVerificationDoc>());

export async function submitIdVerification(
  tradieUid: string,
  fileUrl: string,
  documentType: IdDocType,
): Promise<void> {
  await setDoc(idRef(tradieUid), {
    fileUrl,
    documentType,
    status: "pending",
    submittedAt: serverTimestamp() as never,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
  });
}

export async function getIdVerification(uid: string): Promise<WithId<IdVerificationDoc> | null> {
  const snap = await getDoc(idRef(uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function approveId(uid: string, adminUid: string): Promise<void> {
  await updateDoc(doc(db, "idVerifications", uid), {
    status: "approved",
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp(),
  });
}

export async function rejectId(uid: string, adminUid: string, reason: string): Promise<void> {
  await updateDoc(doc(db, "idVerifications", uid), {
    status: "rejected",
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp(),
    rejectionReason: reason,
  });
}
