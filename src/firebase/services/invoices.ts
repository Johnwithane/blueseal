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
import type { InvoiceDiscount, InvoiceDoc, LineItem, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const invRef = (id: string) => doc(db, "invoices", id).withConverter(typedConverter<InvoiceDoc>());
const invCol = () => collection(db, "invoices").withConverter(typedConverter<InvoiceDoc>());

export interface InvoiceTotals {
  subtotal: number; // pre-discount sum of line subs (cents)
  discountAmount: number; // cents subtracted; 0 when discount is null
  taxTotal: number;
  total: number;
}

/**
 * Compute invoice totals from line items + optional whole-invoice discount.
 *
 * Tax is applied to the post-discount base, proportionally per line — the
 * Canadian retail convention ("10% off $100, then HST on $90"). Mixed tax
 * rates across lines are preserved by scaling each line's taxable base by
 * the same discount factor instead of merging everything into one rate.
 *
 * Pre-discount `subtotal` is exposed separately so the rendered invoice can
 * show the standard four-row breakdown: subtotal · discount · tax · total.
 */
export function recomputeTotals(
  items: LineItem[],
  discount: InvoiceDiscount | null = null,
): InvoiceTotals {
  let subtotal = 0;
  for (const li of items) subtotal += li.quantity * li.unitPrice;

  let discountAmount = 0;
  if (discount && subtotal > 0) {
    if (discount.type === "percent") {
      const pct = Math.max(0, Math.min(100, discount.value));
      discountAmount = Math.round((subtotal * pct) / 100);
    } else {
      discountAmount = Math.max(0, Math.min(subtotal, Math.round(discount.value)));
    }
  }

  const factor = subtotal > 0 ? (subtotal - discountAmount) / subtotal : 1;
  let taxTotal = 0;
  for (const li of items) {
    const lineSub = li.quantity * li.unitPrice;
    taxTotal += Math.round(lineSub * factor * li.taxRate);
  }

  const total = subtotal - discountAmount + taxTotal;
  return { subtotal, discountAmount, taxTotal, total };
}

export async function getInvoice(id: string): Promise<WithId<InvoiceDoc> | null> {
  const snap = await getDoc(invRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeInvoice(
  id: string,
  cb: (inv: WithId<InvoiceDoc> | null) => void,
): () => void {
  return onSnapshot(invRef(id), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
  );
}

export async function updateInvoiceLineItems(id: string, items: LineItem[]): Promise<void> {
  // Re-read the live discount so a line-items edit doesn't accidentally
  // wipe a previously-applied discount on the same write.
  const snap = await getDoc(invRef(id));
  const discount = snap.exists() ? (snap.data().discount ?? null) : null;
  const totals = recomputeTotals(items, discount);
  await updateDoc(doc(db, "invoices", id), { lineItems: items, ...totals });
}

/** Apply or clear the whole-invoice discount and recompute totals. */
export async function updateInvoiceDiscount(
  id: string,
  discount: InvoiceDiscount | null,
): Promise<void> {
  const snap = await getDoc(invRef(id));
  if (!snap.exists()) return;
  const items = snap.data().lineItems ?? [];
  const totals = recomputeTotals(items, discount);
  await updateDoc(doc(db, "invoices", id), { discount, ...totals });
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
