import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
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

/**
 * Withdraw a still-pending ID submission so the owner can re-upload. Admin-side
 * gating is in firestore.rules — this call will fail with permission-denied
 * for approved / rejected IDs (admin handles those cases manually).
 *
 * The Storage file is intentionally left in place; a periodic Cloud Function
 * can sweep orphans. The doc itself is the source-of-truth for status.
 */
export async function deleteIdVerification(uid: string): Promise<void> {
  await deleteDoc(doc(db, "idVerifications", uid));
}
