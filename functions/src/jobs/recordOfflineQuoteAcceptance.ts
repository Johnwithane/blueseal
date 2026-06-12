// Solo-mode (bring-your-own-client) only: the tradesperson attests that
// their off-platform client accepted the quote outside Blue Seal (verbally,
// by text, etc). Mirrors clientAcceptQuote's transaction minus the signature —
// no signature is EVER synthesized (clientSignatureStoragePath stays null;
// writeQuoteSignature remains the only signed-acceptance path), and the quote
// + job are stamped acceptedOffline so the job can never feed public reviews
// (markJobPaid skips ensureReviewPair; the reviews create rules reject it).
// Hard-gated to clientId == null: once a client claims the invite, only THEY
// can accept a quote, with a real signature.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { resolveBillingType, type QuoteLineKindLike } from "../lib/billing";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  // The UI checkbox: "I confirm my client accepted this quote outside Blue
  // Seal." Forcing the literal makes the attestation explicit in the payload.
  attestation: z.literal(true),
});

interface JobData {
  tradespersonId: string;
  clientId: string | null;
  status: string;
  chatId: string;
}

interface QuoteData {
  quoteNumber: string;
  total: number;
  status: string;
  upfrontFee?: { type: "fixed" | "percent"; amountCents: number } | null;
  lineItems?: QuoteLineKindLike[];
}

export const recordOfflineQuoteAcceptance = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const quoteRef = db.doc(`quotes/${jobId}`);

  const result = await db.runTransaction(async (tx) => {
    const [jobSnap, quoteSnap] = await Promise.all([tx.get(jobRef), tx.get(quoteRef)]);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;
    if (job.tradespersonId !== uid) {
      throw new HttpsError("permission-denied", "Not your job.");
    }
    if (job.clientId !== null) {
      throw new HttpsError(
        "failed-precondition",
        "Your client has joined Blue Seal — they accept the quote themselves now.",
      );
    }
    if (job.status !== "quoted") {
      throw new HttpsError(
        "failed-precondition",
        `Job must be in quoted status. Current: ${job.status}.`,
      );
    }
    if (!quoteSnap.exists) throw new HttpsError("not-found", "Quote not found.");
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
    const billingType = resolveBillingType(quote.lineItems);

    if (requiresUpfrontPayment) {
      tx.update(jobRef, {
        status: "awaiting_upfront_payment",
        billingType,
        acceptedOffline: true,
        upfrontFee: {
          amountCents: upfront!.amountCents,
          source: upfront!.type,
          paymentMethod: "manual",
          paidAt: null,
          paidBy: null,
          appliedInvoiceId: null,
        },
      });
    } else {
      tx.update(jobRef, { status: "in_progress", billingType, acceptedOffline: true });
    }
    tx.update(quoteRef, {
      status: "accepted",
      acceptedAt: FieldValue.serverTimestamp(),
      acceptedOffline: true,
      acceptedRecordedBy: uid,
      declinedReason: null,
    });
    return {
      chatId: job.chatId,
      quoteNumber: quote.quoteNumber,
      total: quote.total,
      upfrontFeeCents: requiresUpfrontPayment ? upfront!.amountCents : 0,
    };
  });

  // Honest audit line in the job chat — a later-claiming client sees exactly
  // what was recorded on their behalf, and by whom.
  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Tradesperson recorded: client accepted quote ${result.quoteNumber} ` +
        `($${(result.total / 100).toFixed(2)}) outside Blue Seal. ` +
        `Recorded by the tradesperson — not signed in-app.`,
    );
  }

  logger.info("recordOfflineQuoteAcceptance", {
    jobId,
    tradespersonId: uid,
    quoteNumber: result.quoteNumber,
  });
  return { ok: true };
});
