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
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { InvoiceDiscount, InvoiceDoc, LineItem, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const invRef = (id: string) => doc(db, "invoices", id).withConverter(typedConverter<InvoiceDoc>());
const invCol = () => collection(db, "invoices").withConverter(typedConverter<InvoiceDoc>());

/**
 * The tradesperson's invoices issued within [from, to] — for the Pro business
 * reports + CSV export. Filters the date range client-side off the
 * (tradespersonId, issuedAt) index; the ReportsView aggregates paid revenue +
 * tax from these.
 */
export async function listTradieInvoicesInRange(
  uid: string,
  from: Date,
  to: Date,
): Promise<WithId<InvoiceDoc>[]> {
  const q = query(
    invCol(),
    where("tradespersonId", "==", uid),
    orderBy("issuedAt", "desc"),
    limit(2000),
  );
  const snap = await getDocs(q);
  const fromMs = from.getTime();
  const toMs = to.getTime();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((inv) => {
      const issued = inv.issuedAt?.toMillis?.() ?? null;
      return issued != null && issued >= fromMs && issued <= toMs;
    });
}

export interface InvoiceTotals {
  subtotal: number; // pre-discount sum of line subs (cents)
  discountAmount: number; // cents subtracted; 0 when discount is null
  taxTotal: number;
  /**
   * Pre-credit total: subtotal − discountAmount + taxTotal. Useful when the
   * caller wants the line-item-based total without the upfront-fee deduction
   * (e.g. a tax-base display, or comparing against the quote).
   */
  totalBeforeCredit: number;
  /** Upfront fee credit subtracted from totalBeforeCredit. 0 when none. */
  upfrontFeeCreditAmount: number;
  /** Final total — clamped to zero so a credit larger than the bill never goes negative. */
  total: number;
}

/**
 * Compute invoice totals from line items + optional whole-invoice discount
 * + optional upfront-fee credit (snapshot of an upfront fee collected
 * earlier in the job lifecycle).
 *
 * Tax is applied to the post-discount base, proportionally per line — the
 * Canadian retail convention ("10% off $100, then HST on $90"). Mixed tax
 * rates across lines are preserved by scaling each line's taxable base by
 * the same discount factor instead of merging everything into one rate.
 *
 * Upfront-fee credit is subtracted AFTER tax — the upfront fee was already
 * paid (and tax already applied) at that time, so subtracting before tax
 * would over-tax the remainder.
 *
 * Pre-discount `subtotal` and pre-credit `totalBeforeCredit` are exposed
 * separately so the rendered invoice can show the full breakdown:
 * subtotal · discount · tax · total-before-credit · credit · final-total.
 */
export function recomputeTotals(
  items: LineItem[],
  discount: InvoiceDiscount | null = null,
  upfrontFeeCreditCents = 0,
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

  const totalBeforeCredit = subtotal - discountAmount + taxTotal;
  const upfrontFeeCreditAmount = Math.max(0, Math.round(upfrontFeeCreditCents));
  const total = Math.max(0, totalBeforeCredit - upfrontFeeCreditAmount);
  return { subtotal, discountAmount, taxTotal, totalBeforeCredit, upfrontFeeCreditAmount, total };
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

/**
 * Persisted-shape projection of recomputeTotals. recomputeTotals returns the
 * extra `totalBeforeCredit` / `upfrontFeeCreditAmount` fields for display
 * convenience but InvoiceDoc doesn't carry them — pick only what the doc
 * actually persists. Keeps writes from depositing rogue fields.
 */
function persistableTotals(totals: ReturnType<typeof recomputeTotals>) {
  return {
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxTotal: totals.taxTotal,
    total: totals.total,
  };
}

/**
 * An invoice can never total less than the upfront fee already paid — the
 * credit clamps at $0 due, so the shortfall would silently vanish (no refund
 * path at MVP). Mirrors the submitJobForApproval server check.
 */
function assertCoversUpfrontCredit(totals: InvoiceTotals): void {
  if (totals.upfrontFeeCreditAmount > 0 && totals.totalBeforeCredit < totals.upfrontFeeCreditAmount) {
    throw new Error(
      `The invoice total ($${(totals.totalBeforeCredit / 100).toFixed(2)}) is less than the upfront ` +
        `fee the client already paid ($${(totals.upfrontFeeCreditAmount / 100).toFixed(2)}). ` +
        `The final invoice must cover at least the upfront amount.`,
    );
  }
}

export async function updateInvoiceLineItems(id: string, items: LineItem[]): Promise<void> {
  // Re-read the live discount + upfrontFeeCredit so a line-items edit doesn't
  // accidentally wipe either deduction on the same write.
  const snap = await getDoc(invRef(id));
  const data = snap.exists() ? snap.data() : null;
  const discount = data?.discount ?? null;
  const creditCents = data?.upfrontFeeCredit?.amountCents ?? 0;
  const totals = recomputeTotals(items, discount, creditCents);
  assertCoversUpfrontCredit(totals);
  await updateDoc(doc(db, "invoices", id), { lineItems: items, ...persistableTotals(totals) });
}

/** Apply or clear the whole-invoice discount and recompute totals. */
export async function updateInvoiceDiscount(
  id: string,
  discount: InvoiceDiscount | null,
): Promise<void> {
  const snap = await getDoc(invRef(id));
  if (!snap.exists()) return;
  const items = snap.data().lineItems ?? [];
  const creditCents = snap.data().upfrontFeeCredit?.amountCents ?? 0;
  const totals = recomputeTotals(items, discount, creditCents);
  assertCoversUpfrontCredit(totals);
  await updateDoc(doc(db, "invoices", id), { discount, ...persistableTotals(totals) });
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

// The fee breakdown the client sees on the pay screen + receipt: the platform
// portion (Blue Seal's fee — shown as "Waived" when the tradesperson is Pro)
// and the processing portion (Stripe's cut, always charged), split out so the
// waiver is visible. `totalFeeCents` = platform + processing; the card is
// charged `chargeTotalCents`. These fields are already on the server snapshot
// (snapshotOf spreads the full ServiceFeeQuote) — this just types them.
export interface ClientServiceFee {
  totalFeeCents: number;
  chargeTotalCents: number;
  baseAmountCents: number;
  platformPortionCents: number;
  processingPortionCents: number;
  waived: boolean;
}

export interface PaymentIntentResult {
  clientSecret: string | null;
  serviceFee: ClientServiceFee;
}

/**
 * Create (or refresh) the Stripe PaymentIntent for an invoice at pay time and
 * return the client secret + the service-fee snapshot. Called by InvoicePayView
 * on mount. The fee + Pro waiver are computed server-side against the live
 * invoice total. Rejects (failed-precondition) if the tradesperson hasn't
 * finished payout setup — the caller offers the fee-free offline path instead.
 */
export type RecurringFrequency = "weekly" | "monthly" | "quarterly";

/**
 * Turn an invoice into a recurring template, or turn it off. When enabled, a
 * daily Cloud Function clones it as a fresh DRAFT each period for the
 * tradesperson to review and send (it never auto-sends). nextRunAt is the first
 * clone date — computed from the local clock (a day's tolerance is fine for a
 * schedule). Pro-gated in the UI; the scheduled function re-checks Pro.
 */
export async function setInvoiceRecurring(
  id: string,
  frequency: RecurringFrequency | null,
): Promise<void> {
  if (!frequency) {
    await updateDoc(invRef(id), { recurring: null });
    return;
  }
  const next = new Date();
  if (frequency === "weekly") next.setDate(next.getDate() + 7);
  else if (frequency === "quarterly") next.setMonth(next.getMonth() + 3);
  else next.setMonth(next.getMonth() + 1);
  await updateDoc(invRef(id), {
    recurring: { enabled: true, frequency, nextRunAt: Timestamp.fromDate(next) },
  });
}

export async function createInvoicePaymentIntent(invoiceId: string): Promise<PaymentIntentResult> {
  const fn = httpsCallable<{ invoiceId: string }, PaymentIntentResult>(
    functions,
    "createInvoicePaymentIntent",
  );
  const res = await fn({ invoiceId });
  return res.data;
}

// All invoices for one job, newest first. Unlike getInvoiceByJobId (single
// deterministic doc), this surfaces every invoice on a job — needed for
// recurring plans, where the engine drafts a fresh invoice (auto-id) each
// period on the same backing job. Constrained by tradespersonId so the rules
// authorize the query; two equality filters need no composite index.
export async function listJobInvoices(
  tradieUid: string,
  jobId: string,
): Promise<WithId<InvoiceDoc>[]> {
  const snap = await getDocs(
    query(invCol(), where("tradespersonId", "==", tradieUid), where("jobId", "==", jobId)),
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as WithId<InvoiceDoc>)
    .sort((a, b) => (b.issuedAt?.toMillis?.() ?? 0) - (a.issuedAt?.toMillis?.() ?? 0));
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
