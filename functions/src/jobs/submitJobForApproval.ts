import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";
import {
  extraDescriptionMap,
  rollUpApprovedExtras,
  rollUpExpenses,
  rollUpTimeEntries,
} from "../invoicing/rollUpBillables";

const LineItemSchema = z.object({
  description: z.string().min(1).max(200),
  quantity: z.number().min(0).max(10_000),
  unitPrice: z.number().int().min(0).max(100_000_000),
  taxRate: z.number().min(0).max(1),
});

const DiscountSchema = z.object({
  type: z.enum(["percent", "fixed"]),
  value: z.number().min(0),
  label: z.string().max(60).nullable(),
});

const Input = z.object({
  jobId: z.string().min(1).max(128),
  extraLineItems: z.array(LineItemSchema).max(20).default([]),
  discount: DiscountSchema.nullable().default(null),
  noteToClient: z.string().max(500).default(""),
});

interface UpfrontFeeOnJob {
  amountCents: number;
  paidAt: Timestamp | null;
  appliedInvoiceId: string | null;
}

interface JobData {
  tradespersonId: string;
  clientId: string;
  title: string;
  status: string;
  chatId: string;
  upfrontFee?: UpfrontFeeOnJob | null;
  billingType?: "hourly" | "fixed" | null;
}

interface TimeEntryData {
  tradespersonId: string;
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  hourlyRateSnapshot: number;
  invoicedAt: Timestamp | null;
}

interface LineItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

interface Discount {
  type: "percent" | "fixed";
  value: number;
  label: string | null;
}

/**
 * Mirror of src/firebase/services/invoices.ts → recomputeTotals.
 * Duplicated here because functions/ is a separate package and importing
 * across the boundary tangles the build. Keep them in lockstep — if the
 * math changes, change both.
 */
function computeTotals(
  items: LineItem[],
  discount: Discount | null,
  upfrontFeeCreditCents = 0,
) {
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
  const credit = Math.max(0, Math.round(upfrontFeeCreditCents));
  return {
    subtotal,
    discountAmount,
    taxTotal,
    total: Math.max(0, totalBeforeCredit - credit),
  };
}

/**
 * One-shot "I'm done" callable. Wraps up everything a tradesperson needs to
 * hand the job over to the client for sign-off:
 *
 *   1. Validates the job is in_progress and owned by the caller.
 *   2. Closes any still-running time entries on this job (auto clock-out).
 *   3. Drafts the invoice if it doesn't exist yet (deterministic id = jobId
 *      keeps re-fires idempotent).
 *   4. Rolls up un-invoiced time entries (grouped by rate) + un-invoiced
 *      expenses into invoice line items.
 *   5. Appends any extra one-off line items (trip charge, sourcing fee, etc.)
 *      collected in the wrap-up sheet.
 *   6. Applies the optional whole-invoice discount and recomputes totals.
 *   7. Marks all pulled time entries / expenses as invoicedAt = now in the
 *      same write batch — partial writes can't leave entries stamped as
 *      billed without the line existing.
 *   8. Sets the job to "awaiting_client_approval" and stamps
 *      clientApprovalRequestedAt.
 *   9. Posts a chat system message + notifies the client (high priority —
 *      the client has to act before the invoice is formally sent).
 *
 * The matching client-side path is clientApproveJob (approve) or
 * clientRequestChanges (kick back). onJobUpdated suppresses its generic
 * status-changed line for the awaiting_client_approval transitions because
 * this callable already posts a richer one.
 */
export const submitJobForApproval = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, extraLineItems, discount, noteToClient } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const invoiceRef = db.doc(`invoices/${jobId}`);
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const entriesCol = jobRef.collection("timeEntries");
  const expensesCol = jobRef.collection("expenses");
  const extrasCol = jobRef.collection("extras");

  const [jobSnap, entriesSnap, expensesSnap, extrasSnap, invoiceSnap, tradieSnap] =
    await Promise.all([
      jobRef.get(),
      entriesCol.get(),
      expensesCol.get(),
      extrasCol.get(),
      invoiceRef.get(),
      tradieRef.get(),
    ]);

  if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
  const job = jobSnap.data() as JobData;
  if (job.tradespersonId !== uid) {
    throw new HttpsError("permission-denied", "Not your job.");
  }
  if (job.status !== "in_progress") {
    throw new HttpsError(
      "failed-precondition",
      `Job must be in progress to finish. Current status: ${job.status}.`,
    );
  }
  if (!tradieSnap.exists) {
    throw new HttpsError("failed-precondition", "Tradesperson profile not found.");
  }
  const tradie = tradieSnap.data() as {
    displayName?: string;
    nextInvoiceNumber?: number;
    invoicePrefix?: string;
    paymentInstructions?: string;
  };

  const nowTs = Timestamp.now();
  const nowMs = nowTs.toMillis();

  // ---------- close any open time entries on this job for this tradie ----------
  const openEntryIds: string[] = [];
  for (const d of entriesSnap.docs) {
    const e = d.data() as TimeEntryData;
    if (e.tradespersonId !== uid) continue;
    if (e.endedAt == null) openEntryIds.push(d.id);
  }

  // ---------- existing invoice line ids (skip on pull to avoid dupes) ----------
  let existingLines: LineItem[] = [];
  if (invoiceSnap.exists) {
    const data = invoiceSnap.data() as { lineItems?: LineItem[] };
    existingLines = Array.isArray(data.lineItems) ? data.lineItems : [];
  }
  const existingIds = new Set(
    existingLines.filter((li) => li.id).map((li) => li.id as string),
  );
  // On re-submit (client requested changes → tradie revises), only preserve
  // id-bearing rows (already-billed time entries / expenses). Freeform
  // rows (quote rows + extras) have no id and the wrap-up sheet re-supplies
  // them in `extraLineItems` — keeping them here too would stack the
  // freeform lines on every revision.
  const preservedLines = existingLines.filter((li) => li.id);

  // ---------- roll up time entries by (kind, change order, rate) ----------
  // includeOpen: this is the "I'm done" path, so still-running timers are
  // billed up to now (they're auto-closed in the batch below).
  const timeRoll = rollUpTimeEntries(entriesSnap.docs, {
    nowMs,
    includeOpen: true,
    tradespersonId: uid,
    existingIds,
    billingType: job.billingType ?? null,
    extraDescriptions: extraDescriptionMap(extrasSnap.docs),
  });
  const pulledLines: LineItem[] = [...timeRoll.lines];
  const entryStamps: string[] = [...timeRoll.stampIds];

  // ---------- expenses → one line each (skipped entirely on fixed jobs) ----------
  // On a fixed-price job receipts are cost-tracking only — the agreed price
  // already covers materials; out-of-scope materials bill via a change order.
  const expensesRoll = rollUpExpenses(expensesSnap.docs, {
    existingIds,
    billingType: job.billingType ?? null,
  });
  pulledLines.push(...expensesRoll.lines);
  const expenseStamps: string[] = [...expensesRoll.stampIds];

  // ---------- approved flat change orders → one line each ----------
  const extrasRoll = rollUpApprovedExtras(extrasSnap.docs, existingIds);
  pulledLines.push(...extrasRoll.lines);
  // Flat extras pulled as lines + hourly extras whose time was just billed.
  const extraStamps = [...extrasRoll.stampIds, ...timeRoll.billedExtraIds];

  const mergedLines: LineItem[] = [...preservedLines, ...pulledLines, ...extraLineItems];
  // Upfront fee credit — only honoured when the fee has actually been paid
  // (paidAt set by markUpfrontFeePaid / clientMarkUpfrontFeePaid).
  const upfrontFee = job.upfrontFee ?? null;
  const upfrontCreditCents =
    upfrontFee && upfrontFee.amountCents > 0 && upfrontFee.paidAt
      ? upfrontFee.amountCents
      : 0;
  const totals = computeTotals(mergedLines, discount, upfrontCreditCents);
  const upfrontFeeCredit =
    upfrontCreditCents > 0 && upfrontFee?.paidAt
      ? {
          amountCents: upfrontCreditCents,
          sourceQuoteId: jobId,
          paidAt: upfrontFee.paidAt,
        }
      : null;

  if (mergedLines.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "Nothing to bill — add time, expenses, or a custom line item before finishing.",
    );
  }
  // Pre-credit total has to clear zero. The post-credit total CAN be zero
  // when the upfront fee exactly covered the whole job — that's a valid
  // outcome, not a failed precondition.
  const preCreditTotal = totals.subtotal - totals.discountAmount + totals.taxTotal;
  if (preCreditTotal <= 0) {
    throw new HttpsError(
      "failed-precondition",
      "Nothing to bill — add time, expenses, or a custom line item before finishing.",
    );
  }
  // The final bill can never come in UNDER the upfront fee the client already
  // paid: the credit is clamped at $0 due, so the difference would silently
  // vanish (there's no refund path at MVP — payments are offline or captured
  // at invoice time). Force the tradesperson to bill at least the upfront.
  if (upfrontCreditCents > 0 && preCreditTotal < upfrontCreditCents) {
    throw new HttpsError(
      "failed-precondition",
      `The invoice total ($${(preCreditTotal / 100).toFixed(2)}) is less than the upfront fee the ` +
        `client already paid ($${(upfrontCreditCents / 100).toFixed(2)}). The final invoice must ` +
        `cover at least the upfront amount — add the remaining work or reduce the discount.`,
    );
  }

  // ---------- atomic write ----------
  const batch = db.batch();

  // Close open time entries (set endedAt). Done as part of the same batch so a
  // failure leaves no half-stopped timer.
  for (const id of openEntryIds) {
    batch.update(entriesCol.doc(id), { endedAt: FieldValue.serverTimestamp() });
  }

  // Stamp pulled entries + expenses as invoiced.
  for (const id of entryStamps) {
    batch.update(entriesCol.doc(id), { invoicedAt: FieldValue.serverTimestamp() });
  }
  for (const id of expenseStamps) {
    batch.update(expensesCol.doc(id), {
      invoicedAt: FieldValue.serverTimestamp(),
      status: "invoiced",
    });
  }
  for (const id of extraStamps) {
    batch.update(extrasCol.doc(id), { invoicedAt: FieldValue.serverTimestamp() });
  }

  // Create or update the invoice.
  if (!invoiceSnap.exists) {
    const seq = tradie.nextInvoiceNumber ?? 1;
    const prefix = (tradie.invoicePrefix ?? "INV").trim() || "INV";
    const year = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
    }).format(new Date());
    const invoiceNumber = `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
    batch.set(invoiceRef, {
      tradespersonId: uid,
      clientId: job.clientId,
      jobId,
      invoiceNumber,
      status: "draft",
      lineItems: mergedLines,
      subtotal: totals.subtotal,
      discount,
      discountAmount: totals.discountAmount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      currency: "CAD",
      issuedAt: FieldValue.serverTimestamp(),
      dueAt: null,
      sentAt: null,
      viewedAt: null,
      paidAt: null,
      pdfUrl: null,
      paymentInstructions: tradie.paymentInstructions ?? "",
      paymentMethod: "manual",
      recurring: null,
      upfrontFeeCredit,
    });
    batch.update(tradieRef, { nextInvoiceNumber: seq + 1 });
    if (upfrontFeeCredit && !upfrontFee?.appliedInvoiceId) {
      batch.update(jobRef, { "upfrontFee.appliedInvoiceId": invoiceRef.id });
    }
  } else {
    batch.update(invoiceRef, {
      lineItems: mergedLines,
      subtotal: totals.subtotal,
      discount,
      discountAmount: totals.discountAmount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      // Refresh the credit on re-submits so a quote-side change before
      // approval propagates. No-op when nothing changed.
      upfrontFeeCredit,
    });
    if (upfrontFeeCredit && !upfrontFee?.appliedInvoiceId) {
      batch.update(jobRef, { "upfrontFee.appliedInvoiceId": invoiceRef.id });
    }
  }

  batch.update(jobRef, {
    status: "awaiting_client_approval",
    clientApprovalRequestedAt: FieldValue.serverTimestamp(),
    clientApprovedAt: null,
    // Clear any prior "changes requested" signal so the tradesperson-side
    // banner / "Update invoice" CTA disappears once the revised wrap-up
    // is back in the client's court.
    clientChangesRequestedAt: null,
    clientChangesRequestedReason: null,
  });

  await batch.commit();

  // ---------- chat + notification (best-effort, post-commit) ----------
  const tradieName = tradie.displayName?.trim() || "The tradesperson";
  const messageParts = [
    `${tradieName} marked the work as done.`,
    noteToClient.trim() ? `Note: "${noteToClient.trim()}"` : "",
    `Total: $${(totals.total / 100).toFixed(2)} — review and approve to send the invoice.`,
  ].filter(Boolean);

  if (job.chatId) {
    await postSystemMessage(job.chatId, messageParts.join("\n"));
  }

  await notify({
    userId: job.clientId,
    type: "invoice_sent",
    title: `${tradieName} finished the work`,
    body: `Review the wrap-up and approve to receive the invoice ($${(totals.total / 100).toFixed(2)}).`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: job.chatId ?? null,
    recipientRole: "client",
    priority: "high",
  });

  logger.info("submitJobForApproval", {
    jobId,
    tradespersonId: uid,
    pulledLines: pulledLines.length,
    extraLines: extraLineItems.length,
    closedTimers: openEntryIds.length,
    total: totals.total,
  });

  return { ok: true, total: totals.total, lineItemsCount: mergedLines.length };
});
