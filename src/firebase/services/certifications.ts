import {
  addDoc,
  collection,
  deleteDoc,
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

/**
 * Lets the owning tradesperson withdraw a still-pending submission so they
 * can re-upload. Admin-side gating is in firestore.rules — this call will
 * fail with permission-denied for approved / rejected certs.
 *
 * The associated Storage file is intentionally left in place; a periodic
 * Cloud Function can sweep orphans. Stranding a pending-review file briefly
 * is preferable to a partial delete that leaves the Firestore doc orphaned.
 */
export async function deleteCertification(certId: string): Promise<void> {
  await deleteDoc(doc(db, "certifications", certId));
}

/**
 * Updates the metadata on a still-pending certification (issuing body, cert
 * number, expiry). The Firestore rule only allows this while status is
 * pending, so an approved cert can't be silently mutated post-review.
 *
 * File replacement is intentionally NOT supported here — the user can
 * delete + re-upload if they need to swap the document itself.
 */
export async function updateCertification(
  certId: string,
  patch: { issuingBody: string; certNumber: string; expiresAt: Date | null },
): Promise<void> {
  await updateDoc(doc(db, "certifications", certId), {
    issuingBody: patch.issuingBody,
    certNumber: patch.certNumber,
    expiresAt: patch.expiresAt,
  });
}

/** Sentinel cert number used when a tradesperson declares they don't hold a
 * formal certification for a trade. The vetting admin sees this in the queue
 * and decides whether the trade can proceed without one (e.g. handyman). */
export const NO_CERT_SENTINEL = "No formal certification — self-declared";

export function isSelfDeclaredNoCert(cert: { fileUrl: string; certNumber: string }): boolean {
  return cert.fileUrl === "" && cert.certNumber.startsWith("No formal certification");
}
