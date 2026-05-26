import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";

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

interface TimeEntryLike {
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  hourlyRateSnapshot: number;
  invoicedAt: Timestamp | null;
}

interface ExpenseLike {
  description: string;
  billedAmount: number;
  invoicedAt: Timestamp | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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
export const pullBillablesFromJob = onCall({ enforceAppCheck: false }, async (req) => {
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
  const [entriesSnap, expensesSnap] = await Promise.all([
    jobRef.collection("timeEntries").get(),
    jobRef.collection("expenses").get(),
  ]);

  // Existing ids on the invoice — skip these on the pull side too, so an
  // accidental partial-write race doesn't double-add when retried.
  const existingIds = new Set(
    invoice.lineItems.filter((li) => li.id).map((li) => li.id as string),
  );

  // ---------- time entries: group by rate ----------
  const entryRollup = new Map<number, { hours: number; ids: string[] }>();
  for (const doc of entriesSnap.docs) {
    if (existingIds.has(doc.id)) continue;
    const e = doc.data() as TimeEntryLike;
    if (e.invoicedAt != null) continue;
    if (e.endedAt == null) continue; // still running — skip
    const elapsedMs = e.endedAt.toMillis() - e.startedAt.toMillis();
    if (elapsedMs <= 0) continue;
    const hours = elapsedMs / 3_600_000;
    const rate = Math.max(0, Math.floor(e.hourlyRateSnapshot));
    const bucket = entryRollup.get(rate) ?? { hours: 0, ids: [] };
    bucket.hours += hours;
    bucket.ids.push(doc.id);
    entryRollup.set(rate, bucket);
  }

  const newLines: LineItem[] = [];
  const entryStamps: { id: string }[] = [];
  for (const [rate, { hours, ids }] of entryRollup.entries()) {
    if (hours <= 0) continue;
    const qty = round2(hours);
    // Use a deterministic id derived from the first contributing entry so
    // existingIds dedupe works on retry. Concat all ids into description
    // metadata is overkill — invoicedAt stamps are the source of truth.
    newLines.push({
      id: ids[0],
      description:
        rate === 0
          ? `Labour: ${qty}h`
          : `Labour: ${qty}h @ $${(rate / 100).toFixed(2)}/hr`,
      quantity: qty,
      unitPrice: rate,
      taxRate: 0,
    });
    for (const id of ids) entryStamps.push({ id });
  }

  // ---------- expenses: one line each ----------
  const expenseStamps: { id: string }[] = [];
  for (const doc of expensesSnap.docs) {
    if (existingIds.has(doc.id)) continue;
    const x = doc.data() as ExpenseLike;
    if (x.invoicedAt != null) continue;
    if ((x.billedAmount ?? 0) <= 0) continue;
    newLines.push({
      id: doc.id,
      description: x.description?.trim() || "Materials",
      quantity: 1,
      unitPrice: x.billedAmount,
      taxRate: 0,
    });
    expenseStamps.push({ id: doc.id });
  }

  if (newLines.length === 0) {
    return { added: 0, lineItemsCount: invoice.lineItems.length };
  }

  // ---------- recompute totals on the merged line set ----------
  // Apply the existing whole-invoice discount + upfront-fee credit so a
  // pull doesn't accidentally wipe either deduction.
  const merged: LineItem[] = [...invoice.lineItems, ...newLines];
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
  for (const { id } of expenseStamps) {
    batch.update(jobRef.collection("expenses").doc(id), {
      invoicedAt: FieldValue.serverTimestamp(),
      status: "invoiced",
    });
  }
  await batch.commit();

  logger.info("pullBillablesFromJob", {
    invoiceId: parsed.data.invoiceId,
    jobId: invoice.jobId,
    added: newLines.length,
    timeEntries: entryStamps.length,
    expenses: expenseStamps.length,
  });

  return { added: newLines.length, lineItemsCount: merged.length };
});
