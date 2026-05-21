import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { CertificationDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const certsCol = () =>
  collection(db, "certifications").withConverter(typedConverter<CertificationDoc>());

export async function createCertification(
  input: Omit<
    CertificationDoc,
    "status" | "reviewedBy" | "reviewedAt" | "rejectionReason" | "submittedAt"
  >,
): Promise<string> {
  const ref = await addDoc(certsCol(), {
    ...input,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    submittedAt: serverTimestamp() as never,
  });
  return ref.id;
}

export async function listCertsFor(tradespersonId: string): Promise<WithId<CertificationDoc>[]> {
  const q = query(certsCol(), where("tradespersonId", "==", tradespersonId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function approveCertification(certId: string, adminUid: string): Promise<void> {
  await updateDoc(doc(db, "certifications", certId), {
    status: "approved",
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp(),
  });
}

export async function rejectCertification(
  certId: string,
  adminUid: string,
  reason: string,
): Promise<void> {
  await updateDoc(doc(db, "certifications", certId), {
    status: "rejected",
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp(),
    rejectionReason: reason,
  });
}
