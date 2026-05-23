import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { InvoiceDoc, LineItem, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const invRef = (id: string) => doc(db, "invoices", id).withConverter(typedConverter<InvoiceDoc>());
const invCol = () => collection(db, "invoices").withConverter(typedConverter<InvoiceDoc>());

export function recomputeTotals(items: LineItem[]) {
  let subtotal = 0;
  let taxTotal = 0;
  for (const li of items) {
    const lineSub = li.quantity * li.unitPrice;
    subtotal += lineSub;
    taxTotal += Math.round(lineSub * li.taxRate);
  }
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

export async function getInvoice(id: string): Promise<WithId<InvoiceDoc> | null> {
  const snap = await getDoc(invRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateInvoiceLineItems(id: string, items: LineItem[]): Promise<void> {
  const totals = recomputeTotals(items);
  await updateDoc(doc(db, "invoices", id), { lineItems: items, ...totals });
}

export async function markInvoicePaid(id: string): Promise<void> {
  await updateDoc(doc(db, "invoices", id), {
    status: "paid",
    paidAt: serverTimestamp(),
  });
}

export async function markInvoiceViewed(id: string): Promise<void> {
  const snap = await getDoc(invRef(id));
  if (!snap.exists() || snap.data().status !== "sent") return;
  await updateDoc(doc(db, "invoices", id), { status: "viewed", viewedAt: serverTimestamp() });
}

export function subscribeTradieInvoices(
  uid: string,
  cb: (inv: WithId<InvoiceDoc>[]) => void,
): () => void {
  const q = query(
    invCol(),
    where("tradespersonId", "==", uid),
    orderBy("issuedAt", "desc"),
    limit(100),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function listClientInvoices(clientUid: string): Promise<WithId<InvoiceDoc>[]> {
  const q = query(
    invCol(),
    where("clientId", "==", clientUid),
    orderBy("issuedAt", "desc"),
    limit(100),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export interface PullBillablesResult {
  added: number;
  lineItemsCount: number;
}

/**
 * Pull all un-invoiced, closed time entries + un-invoiced expenses on the
 * job into the invoice as new line items. Idempotent: a second click
 * does nothing if nothing new accrued. Callable enforces the
 * "tradie-owns-this-invoice" + "invoice not paid" checks.
 */
export async function pullBillablesFromJob(invoiceId: string): Promise<PullBillablesResult> {
  const fn = httpsCallable<{ invoiceId: string }, PullBillablesResult>(
    functions,
    "pullBillablesFromJob",
  );
  const res = await fn({ invoiceId });
  return res.data;
}

export async function getInvoiceByJobId(jobId: string): Promise<WithId<InvoiceDoc> | null> {
  // Must use a query, NOT getDoc(invoices/{jobId}). Even though
  // onJobCompleted writes invoices/{jobId} deterministically, the direct
  // getDoc trips a Firestore-rules NPE when the doc doesn't exist yet:
  // the read rule references resource.data.clientId, but `resource` is
  // null for missing docs, and Firestore surfaces the null-eval error
  // to the client as permission-denied — even for users who would
  // otherwise be allowed. The query path filters server-side and
  // returns empty for missing docs without tripping the rule evaluator.
  const q = query(invCol(), where("jobId", "==", jobId), limit(1));
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}
