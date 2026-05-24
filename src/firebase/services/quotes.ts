import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type FirestoreError,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { InvoiceDiscount, LineItem, QuoteDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";
import { recomputeTotals } from "./invoices";

const quoteRef = (id: string) =>
  doc(db, "quotes", id).withConverter(typedConverter<QuoteDoc>());
const quoteCol = () => collection(db, "quotes").withConverter(typedConverter<QuoteDoc>());

export async function getQuote(id: string): Promise<WithId<QuoteDoc> | null> {
  const snap = await getDoc(quoteRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getQuoteByJobId(jobId: string): Promise<WithId<QuoteDoc> | null> {
  // Mirrors getInvoiceByJobId: try deterministic id first (quotes/{jobId}
  // matches what submitQuote writes), fall back to a collection query for
  // legacy / future deviations. Both reads tolerate permission-denied
  // (Firestore evaluates rules against resource which is null for missing
  // docs, which surfaces as denied even when the caller would be allowed
  // for a real doc).
  try {
    const direct = await getDoc(quoteRef(jobId));
    if (direct.exists()) return { id: direct.id, ...direct.data() };
  } catch {
    /* fall through */
  }
  try {
    const q = query(quoteCol(), where("jobId", "==", jobId), limit(1));
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch {
    return null;
  }
}

export function subscribeQuote(
  id: string,
  cb: (q: WithId<QuoteDoc> | null) => void,
  onError?: (err: FirestoreError) => void,
): () => void {
  return onSnapshot(
    quoteRef(id),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => {
      console.warn(`[Firestore] quotes/${id} listener:`, err.code, err.message);
      onError?.(err);
    },
  );
}

/** Tradesperson edit of quote line items (only valid in draft/sent states). */
export async function updateQuoteLineItems(id: string, items: LineItem[]): Promise<void> {
  const snap = await getDoc(quoteRef(id));
  const discount = snap.exists() ? (snap.data().discount ?? null) : null;
  const totals = recomputeTotals(items, discount);
  await updateDoc(doc(db, "quotes", id), { lineItems: items, ...totals });
}

export async function updateQuoteDiscount(
  id: string,
  discount: InvoiceDiscount | null,
): Promise<void> {
  const snap = await getDoc(quoteRef(id));
  if (!snap.exists()) return;
  const items = snap.data().lineItems ?? [];
  const totals = recomputeTotals(items, discount);
  await updateDoc(doc(db, "quotes", id), { discount, ...totals });
}

/** Soft signal: client viewed the quote. Only stamps on transition from sent → viewed. */
export async function markQuoteViewed(id: string): Promise<void> {
  const snap = await getDoc(quoteRef(id));
  if (!snap.exists() || snap.data().status !== "sent") return;
  await updateDoc(doc(db, "quotes", id), {
    status: "viewed",
    viewedAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Callable wrappers. Server-side validation + state transitions live in
// functions/src/jobs/{submitQuote,clientAcceptQuote,clientDeclineQuote}.ts.
// ---------------------------------------------------------------------------

export interface SubmitQuoteInput {
  jobId: string;
  lineItems: LineItem[];
  discount?: InvoiceDiscount | null;
  estimatedHours?: number | null;
  validUntilDays?: number; // days from now; server clamps to 1-180
  terms?: string;
  noteToClient?: string;
}

export async function submitQuote(
  input: SubmitQuoteInput,
): Promise<{ ok: true; total: number; quoteNumber: string }> {
  const fn = httpsCallable<SubmitQuoteInput, { ok: true; total: number; quoteNumber: string }>(
    functions,
    "submitQuote",
  );
  const res = await fn(input);
  return res.data;
}

export async function clientAcceptQuote(jobId: string): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string }, { ok: true }>(functions, "clientAcceptQuote");
  const res = await fn({ jobId });
  return res.data;
}

export async function clientDeclineQuote(
  jobId: string,
  reason: string,
): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string; reason: string }, { ok: true }>(
    functions,
    "clientDeclineQuote",
  );
  const res = await fn({ jobId, reason });
  return res.data;
}
