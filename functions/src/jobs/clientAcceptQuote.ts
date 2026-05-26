import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";

const Input = z.object({
  jobId: z.string().min(1).max(128),
});

interface JobData {
  tradespersonId: string;
  clientId: string;
  status: string;
  chatId: string;
}

interface QuoteUpfrontFeeData {
  type: "fixed" | "percent";
  amountCents: number;
  bps?: number;
}

interface QuoteData {
  quoteNumber: string;
  total: number;
  status: string;
  upfrontFee?: QuoteUpfrontFeeData | null;
}

/**
 * Client accepts the quote. Atomically transitions the job to "in_progress"
 * (the scheduling step is no longer a status gate — date pick is metadata
 * the tradesperson can fill in from the Schedule tab) and the quote doc to
 * "accepted".
 *
 * If the accepted quote required an upfront fee, the job lands in
 * "awaiting_upfront_payment" instead — work doesn't start until the fee is
 * marked paid via markUpfrontFeePaid / clientMarkUpfrontFeePaid (or the
 * Stripe Connect dispatcher, once that's enabled).
 *
 * onJobUpdated suppresses its generic line for the quoted → in_progress
 * AND the quoted → awaiting_upfront_payment transitions (richer messages
 * are posted here).
 */
export const clientAcceptQuote = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const quoteRef = db.doc(`quotes/${jobId}`);

  const result = await db.runTransaction(async (tx) => {
    const [jobSnap, quoteSnap] = await Promise.all([tx.get(jobRef), tx.get(quoteRef)]);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;
    if (job.clientId !== uid) {
      throw new HttpsError("permission-denied", "Not your job.");
    }
    if (job.status !== "quoted") {
      throw new HttpsError(
        "failed-precondition",
        `Job must be in quoted status to accept. Current: ${job.status}.`,
      );
    }
    if (!quoteSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Quote not found — ask the tradesperson to re-send.",
      );
    }
    const quote = quoteSnap.data() as QuoteData;
    if (!["sent", "viewed"].includes(quote.status)) {
      throw new HttpsError(
        "failed-precondition",
        `Quote can't be accepted from status "${quote.status}".`,
      );
    }
    if (quote.total <= 0) {
      throw new HttpsError("failed-precondition", "Quote has zero total.");
    }

    const upfront = quote.upfrontFee ?? null;
    const requiresUpfrontPayment = upfront != null && upfront.amountCents > 0;

    if (requiresUpfrontPayment) {
      tx.update(jobRef, {
        status: "awaiting_upfront_payment",
        upfrontFee: {
          amountCents: upfront!.amountCents,
          source: upfront!.type,
          // Manual is the only resolution path live today; the Stripe webhook
          // dispatcher will overwrite paymentMethod + paidBy when Connect is
          // enabled. Mirrors InvoiceDoc.paymentMethod for consistency.
          paymentMethod: "manual",
          paidAt: null,
          paidBy: null,
          appliedInvoiceId: null,
        },
      });
    } else {
      tx.update(jobRef, { status: "in_progress" });
    }
    tx.update(quoteRef, {
      status: "accepted",
      acceptedAt: FieldValue.serverTimestamp(),
      declinedReason: null,
    });
    return {
      tradespersonId: job.tradespersonId,
      chatId: job.chatId,
      quoteNumber: quote.quoteNumber,
      total: quote.total,
      upfrontFeeCents: requiresUpfrontPayment ? upfront!.amountCents : 0,
    };
  });

  if (result.chatId) {
    const message = result.upfrontFeeCents > 0
      ? `Client accepted quote ${result.quoteNumber} ($${(result.total / 100).toFixed(2)}). $${(result.upfrontFeeCents / 100).toFixed(2)} upfront fee due before work begins.`
      : `Client accepted quote ${result.quoteNumber} ($${(result.total / 100).toFixed(2)}). Job is now active — invoice when the work is done.`;
    await postSystemMessage(result.chatId, message);
  }

  await notify({
    userId: result.tradespersonId,
    type: "invoice_sent",
    title: "Client accepted your quote",
    body:
      result.upfrontFeeCents > 0
        ? `${result.quoteNumber} accepted. Awaiting $${(result.upfrontFeeCents / 100).toFixed(2)} upfront fee before you start.`
        : `${result.quoteNumber} ($${(result.total / 100).toFixed(2)}). Job is now active — invoice when finished.`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    recipientRole: "tradesperson",
    priority: "high",
  });

  logger.info("clientAcceptQuote", {
    jobId,
    clientId: uid,
    quoteNumber: result.quoteNumber,
  });
  return { ok: true };
});
