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
import { db } from "@/firebase/config";
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
  const q = query(invCol(), where("clientId", "==", clientUid), orderBy("issuedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
