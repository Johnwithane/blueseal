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

// Live subscription for the payment + receipt views — they need to react
// the moment the Stripe webhook flips status from `processing` to `paid`
// (or the inverse for a refund) without the user reloading.
export function subscribeInvoice(
  id: string,
  cb: (inv: WithId<InvoiceDoc> | null) => void,
): () => void {
  return onSnapshot(invRef(id), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
  );
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
  // Try the deterministic ID first (onJobCompleted writes invoices/{jobId}).
  // Both reads are wrapped in try/catch because Firestore returns
  // permission-denied — NOT not-found — when the rule evaluator NPEs on a
  // missing doc (resource.data.X with resource==null), which is the common
  // case for jobs that aren't completed yet. Treat any read failure as
  // "no invoice exists for the caller" — the caller wants nullable, not
  // throwable, and the underlying rule still protects actual access.
  try {
    const direct = await getDoc(invRef(jobId));
    if (direct.exists()) return { id: direct.id, ...direct.data() };
  } catch {
    /* fall through */
  }
  try {
    const q = query(invCol(), where("jobId", "==", jobId), limit(1));
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch {
    return null;
  }
}
