import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import {
  consolidateHourlyLines,
  extraDescriptionMap,
  rollUpApprovedExtras,
  rollUpExpenses,
  rollUpTimeEntries,
} from "./rollUpBillables";

const Input = z.object({
  invoiceId: z.string().min(1).max(128),
});

interface InvoiceLike {
  tradespersonId: string;
  jobId: string;
  status: string;
  lineItems: LineItem[];
  discount?: { type: "percent" | "fixed"; value: number } | null;
  upfrontFeeCredit?: { amountCents: number } | null;
}

interface LineItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

/**
 * Pull all un-invoiced, closed time entries + expenses on a job into the
 * draft invoice as line items, then stamp invoicedAt on each pulled
 * source row. Idempotent — sources with invoicedAt != null are skipped,
 * so a second click is a no-op rather than a double-bill.
 *
 * Time entries are grouped by hourly rate (almost always a single group)
 * to keep the invoice tight: one "Labour: 12.5h @ $85/hr" line per rate.
 * Expenses each get their own line at billedAmount (markup already
 * applied client-side; the client never sees totalCost or the receipt).
 *
 * The whole pull commits as a single Firestore batch so a partial write
 * can't leave entries marked invoiced but missing from the line items.
 */
export const pullBillablesFromJob = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);

  const invoiceRef = db.doc(`invoices/${parsed.data.invoiceId}`);
  const invoiceSnap = await invoiceRef.get();
  if (!invoiceSnap.exists) throw new HttpsError("not-found", "Invoice not found.");
  const invoice = invoiceSnap.data() as InvoiceLike;
  if (invoice.tradespersonId !== uid) {
    throw new HttpsError("permission-denied", "Not your invoice.");
  }
  if (invoice.status === "paid" || invoice.status === "void") {
    throw new HttpsError(
      "failed-precondition",
      `Can't add lines to a ${invoice.status} invoice.`,
    );
  }

  const jobRef = db.doc(`jobs/${invoice.jobId}`);
  const [jobSnap, entriesSnap, expensesSnap, extrasSnap] = await Promise.all([
    jobRef.get(),
    jobRef.collection("timeEntries").get(),
    jobRef.collection("expenses").get(),
    jobRef.collection("extras").get(),
  ]);
  const jobData = jobSnap.data() as
    | { billingType?: "hourly" | "fixed" | null; defaultTaxRate?: number | null }
    | undefined;
  const jobBillingType = jobData?.billingType ?? null;
  // Inherit the accepted quote's tax rate onto pulled labour/expense/change-order
  // lines so they aren't silently billed at 0% (P1-11). Legacy jobs (no stamp) → 0.
  const jobTaxRate = Math.max(0, jobData?.defaultTaxRate ?? 0);

  // Existing ids on the invoice — skip these on the pull side too, so an
  // accidental partial-write race doesn't double-add when retried.
  const existingIds = new Set(
    invoice.lineItems.filter((li) => li.id).map((li) => li.id as string),
  );

  // ---------- time entries: group by (kind, extra, rate) ----------
  const timeRoll = rollUpTimeEntries(entriesSnap.docs, {
    nowMs: Timestamp.now().toMillis(),
    includeOpen: false, // pull never closes a running timer
    tradespersonId: invoice.tradespersonId,
    existingIds,
    billingType: jobBillingType,
    taxRate: jobTaxRate,
    extraDescriptions: extraDescriptionMap(extrasSnap.docs),
  });
  const newLines: LineItem[] = [...timeRoll.lines];
  const entryStamps: { id: string }[] = timeRoll.stampIds.map((id) => ({ id }));

  // ---------- expenses: one line each (skipped on fixed-price jobs) ----------
  // Fixed-price receipts are cost-tracking only; the agreed price covers
  // materials and out-of-scope ones bill via an approved change order.
  const expensesRoll = rollUpExpenses(expensesSnap.docs, {
    existingIds,
    billingType: jobBillingType,
    taxRate: jobTaxRate,
  });
  newLines.push(...expensesRoll.lines);
  const expenseStamps: string[] = [...expensesRoll.stampIds];

  // ---------- approved flat change orders: one line each ----------
  const extrasRoll = rollUpApprovedExtras(extrasSnap.docs, existingIds, jobTaxRate);
  newLines.push(...extrasRoll.lines);
  // Stamp the flat extras pulled here + the hourly extras whose time was billed.
  const extraStampIds = [...extrasRoll.stampIds, ...timeRoll.billedExtraIds];

  if (newLines.length === 0) {
    return { added: 0, lineItemsCount: invoice.lineItems.length };
  }

  // ---------- recompute totals on the merged line set ----------
  // Apply the existing whole-invoice discount + upfront-fee credit so a
  // pull doesn't accidentally wipe either deduction. Consolidate first so the
  // newly-pulled hours fold into any existing same-rate labour/travel line
  // rather than stacking as a second line (subtotal is unchanged).
  const merged: LineItem[] = consolidateHourlyLines([...invoice.lineItems, ...newLines]);
  let subtotal = 0;
  for (const li of merged) subtotal += li.quantity * li.unitPrice;
  let discountAmount = 0;
  if (invoice.discount && subtotal > 0) {
    if (invoice.discount.type === "percent") {
      const pct = Math.max(0, Math.min(100, invoice.discount.value));
      discountAmount = Math.round((subtotal * pct) / 100);
    } else {
      discountAmount = Math.max(0, Math.min(subtotal, Math.round(invoice.discount.value)));
    }
  }
  const factor = subtotal > 0 ? (subtotal - discountAmount) / subtotal : 1;
  let taxTotal = 0;
  for (const li of merged) {
    const sub = li.quantity * li.unitPrice;
    taxTotal += Math.round(sub * factor * li.taxRate);
  }
  const creditAmount = Math.max(0, invoice.upfrontFeeCredit?.amountCents ?? 0);
  const total = Math.max(0, subtotal - discountAmount + taxTotal - creditAmount);

  const batch = db.batch();
  batch.update(invoiceRef, {
    lineItems: merged,
    subtotal,
    discountAmount,
    taxTotal,
    total,
  });
  for (const { id } of entryStamps) {
    batch.update(jobRef.collection("timeEntries").doc(id), {
      invoicedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const id of expenseStamps) {
    batch.update(jobRef.collection("expenses").doc(id), {
      invoicedAt: FieldValue.serverTimestamp(),
      status: "invoiced",
    });
  }
  for (const id of extraStampIds) {
    batch.update(jobRef.collection("extras").doc(id), {
      invoicedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  logger.info("pullBillablesFromJob", {
    invoiceId: parsed.data.invoiceId,
    jobId: invoice.jobId,
    added: newLines.length,
    timeEntries: entryStamps.length,
    expenses: expenseStamps.length,
    extras: extraStampIds.length,
  });

  return { added: newLines.length, lineItemsCount: merged.length };
});
