// Draft a standalone invoice for a job, straight from the Invoice tab.
//
// Every other invoice-creation path is derived from something else: the
// wrap-up sheet (submitJobForApproval) rolls up tracked time / expenses /
// change orders, onJobCompleted fires off a status transition, and
// createRecurringPlan clones a billing template. That left no way to just
// *write an invoice* — a tradesperson billing a callout with no quote and no
// clocked hours had nothing to click.
//
// This callable mints the same draft those paths produce (deterministic id =
// jobId, so a later wrap-up updates THIS doc instead of stacking a second
// invoice), and then gets out of the way: the InvoiceEditor on the Invoice tab
// owns the line items, discount and send from there.
//
// Deliberately does NOT touch the job status. Drafting an invoice is a private
// act by the tradesperson — the client is only pulled in when the invoice is
// actually sent (sendInvoice) or the job is submitted for approval.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";

const Input = z.object({ jobId: z.string().min(1).max(128) });

// Job statuses where an invoice must not be conjured up. Mirrors the
// `lockedStatuses` set the Invoice tab uses to make the editor read-only:
// past this point the client has either committed to a specific total or the
// job is dead, so a fresh invoice would be un-editable the moment it existed.
// (In practice these statuses already carry an invoice — the guard is here so
// a stale client can't create an orphan the tradesperson can never touch.)
const LOCKED_JOB_STATUSES = new Set([
  "awaiting_client_approval",
  "awaiting_payment",
  "complete",
  "reviewed",
  "cancelled",
]);

interface JobData {
  tradespersonId: string;
  clientId: string | null;
  title?: string;
  status: string;
  defaultTaxRate?: number | null;
  upfrontFee?: {
    amountCents: number;
    paidAt: Timestamp | null;
    appliedInvoiceId: string | null;
  } | null;
}

export const createManualInvoice = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { jobId } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const invoiceRef = db.doc(`invoices/${jobId}`);
  const tradieRef = db.doc(`tradespeople/${uid}`);

  const ctx = { fn: "createManualInvoice", uid, jobId };
  logger.info("starting", ctx);

  try {
    const result = await db.runTransaction(async (tx) => {
      const [jobSnap, invoiceSnap, tradieSnap] = await Promise.all([
        tx.get(jobRef),
        tx.get(invoiceRef),
        tx.get(tradieRef),
      ]);

      if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
      const job = jobSnap.data() as JobData;
      if (job.tradespersonId !== uid) {
        throw new HttpsError("permission-denied", "Not your job.");
      }

      // Idempotent: a double-tap (or a race with the wrap-up sheet) returns the
      // existing draft instead of burning a second invoice number.
      if (invoiceSnap.exists) {
        return { invoiceId: invoiceRef.id, created: false };
      }

      if (LOCKED_JOB_STATUSES.has(job.status)) {
        throw new HttpsError(
          "failed-precondition",
          `This job is ${job.status.replace(/_/g, " ")} — an invoice can't be started now.`,
        );
      }
      if (!tradieSnap.exists) {
        throw new HttpsError("failed-precondition", "Tradesperson profile not found.");
      }

      const tradie = tradieSnap.data() as {
        nextInvoiceNumber?: number;
        invoicePrefix?: string;
        paymentInstructions?: string;
      };
      const seq = tradie.nextInvoiceNumber ?? 1;
      const prefix = (tradie.invoicePrefix ?? "INV").trim() || "INV";
      // Year from Toronto local time, not the us-central1 runtime's.
      const year = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        year: "numeric",
      }).format(new Date());
      const invoiceNumber = `${prefix}-${year}-${String(seq).padStart(4, "0")}`;

      // Credit an upfront fee the client has already PAID, unless it's already
      // been consumed by another invoice. Without this a manual invoice would
      // bill the full job again on top of the upfront the client settled.
      const fee = job.upfrontFee ?? null;
      const creditable =
        fee &&
        fee.amountCents > 0 &&
        fee.paidAt &&
        (fee.appliedInvoiceId == null || fee.appliedInvoiceId === invoiceRef.id);
      const upfrontFeeCredit = creditable
        ? { amountCents: fee.amountCents, sourceQuoteId: jobId, paidAt: fee.paidAt }
        : null;

      // One starter line so the editor opens on something editable rather than
      // an empty table — same seed onJobCompleted writes. Zero-priced, so the
      // draft can't be sent until the tradesperson prices it (sendInvoice
      // rejects a total of 0).
      const taxRate = Math.max(0, Math.min(1, job.defaultTaxRate ?? 0));
      tx.set(invoiceRef, {
        tradespersonId: uid,
        clientId: job.clientId ?? null,
        jobId,
        invoiceNumber,
        status: "draft",
        lineItems: [
          {
            description: job.title?.trim() || "Work completed",
            quantity: 1,
            unitPrice: 0,
            taxRate,
          },
        ],
        subtotal: 0,
        discount: null,
        discountAmount: 0,
        taxTotal: 0,
        total: 0,
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
      tx.update(tradieRef, { nextInvoiceNumber: seq + 1 });
      if (upfrontFeeCredit && fee?.appliedInvoiceId == null) {
        tx.update(jobRef, { "upfrontFee.appliedInvoiceId": invoiceRef.id });
      }

      return { invoiceId: invoiceRef.id, created: true, invoiceNumber };
    });

    logger.info("success", { ...ctx, ...result });
    return result;
  } catch (err) {
    logger.error("failed", { ...ctx, err });
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "Couldn't start the invoice.");
  }
});
