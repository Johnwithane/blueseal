import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type UpdateData,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth as fbAuth, db, functions, storage } from "@/firebase/config";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import type { ExpenseDoc, ExpenseCategory, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const expensesCol = (jobId: string) =>
  collection(db, "jobs", jobId, "expenses").withConverter(typedConverter<ExpenseDoc>());
const expenseRef = (jobId: string, id: string) => doc(db, "jobs", jobId, "expenses", id);

export const DEFAULT_MARKUP_PERCENT = 15;

export function subscribeJobExpenses(
  jobId: string,
  cb: (rows: WithId<ExpenseDoc>[]) => void,
): () => void {
  const q = query(expensesCol(jobId), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function listJobExpenses(jobId: string): Promise<WithId<ExpenseDoc>[]> {
  const snap = await getDocs(query(expensesCol(jobId), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function extForFile(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
  // The storage rules only accept webp/pdf — non-webp images are converted by
  // the caller (browser canvas → webp) before upload. Default to webp.
  return "webp";
}

export interface UploadReceiptResult {
  expenseId: string;
  storagePath: string;
}

/**
 * Upload a receipt file and create the parsing-status expense doc that the
 * parseReceipt callable will fill in. Returns immediately after both writes
 * succeed; the caller fires parseReceipt() in the background and watches the
 * doc snapshot for parsed fields.
 */
export async function uploadReceiptAndCreateExpense(
  jobId: string,
  clientId: string,
  file: File,
): Promise<UploadReceiptResult> {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) throw new Error("Sign in required to upload a receipt.");
  // Random suffix avoids collisions when the tradie uploads two receipts in
  // the same millisecond (rare but mobile clock resolution is coarse).
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `jobs/${jobId}/receipts/${Date.now()}_${rand}.${extForFile(file)}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file, { contentType: file.type || "application/octet-stream" });

  const docRef = await addDoc(expensesCol(jobId), {
    tradespersonId: uid,
    clientId,
    description: "",
    vendor: null,
    spentAt: null,
    totalCost: 0,
    markupPercent: DEFAULT_MARKUP_PERCENT,
    billedAmount: 0,
    category: null,
    receiptStoragePath: path,
    status: "parsing",
    aiParsed: false,
    createdAt: serverTimestamp() as never,
    updatedAt: serverTimestamp() as never,
    invoicedAt: null,
  });
  return { expenseId: docRef.id, storagePath: path };
}

export interface ExpensePatch {
  description?: string;
  totalCost?: number;
  markupPercent?: number;
  billedAmount?: number;
  category?: ExpenseCategory | null;
  vendor?: string | null;
  spentAt?: Date | null;
}

export async function updateExpense(
  jobId: string,
  expenseId: string,
  patch: ExpensePatch,
): Promise<void> {
  const update: UpdateData<ExpenseDoc> = { updatedAt: serverTimestamp() };
  if (patch.description !== undefined) update.description = patch.description.slice(0, 300);
  if (patch.totalCost !== undefined)
    update.totalCost = Math.max(0, Math.round(patch.totalCost));
  if (patch.markupPercent !== undefined)
    update.markupPercent = Math.max(0, Math.min(1000, patch.markupPercent));
  if (patch.billedAmount !== undefined)
    update.billedAmount = Math.max(0, Math.round(patch.billedAmount));
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.vendor !== undefined) update.vendor = patch.vendor;
  if (patch.spentAt !== undefined) update.spentAt = patch.spentAt;
  await updateDoc(expenseRef(jobId, expenseId), update);
}

export async function deleteExpense(jobId: string, expenseId: string): Promise<void> {
  await deleteDoc(expenseRef(jobId, expenseId));
}

export async function parseReceiptCallable(
  jobId: string,
  expenseId: string,
): Promise<{ ok: boolean; aiParsed: boolean }> {
  const fn = httpsCallable<
    { jobId: string; expenseId: string },
    { ok: boolean; aiParsed: boolean }
  >(functions, "parseReceipt");
  const res = await fn({ jobId, expenseId });
  return res.data;
}

export function computeBilledAmount(totalCost: number, markupPercent: number): number {
  return Math.round(totalCost * (1 + markupPercent / 100));
}

/** Resolve a Storage path receipt to a download URL (admin or owner only). */
export async function getReceiptDownloadUrl(storagePath: string): Promise<string> {
  return getDownloadURL(storageRef(storage, storagePath));
}
