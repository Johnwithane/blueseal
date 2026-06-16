import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";
import { resolveBillingType, type QuoteLineKindLike } from "../lib/billing";
import { SignatureDataUrl, writeQuoteSignature } from "../lib/signature";
import {
  isTradieInsured,
  UNINSURED_DISCLOSURE_VERSION,
  type InsuranceStatusFields,
} from "../lib/insurance";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  // Required: the client signs the quote to accept it (the signature IS the
  // acceptance). The capture UI is live, so every accept sends one.
  signatureDataUrl: SignatureDataUrl,
  // True when the client has ticked the uninsured-work disclosure. Only needed
  // when the assigned tradesperson has no current liability insurance; the
  // server re-checks insurance, so this is never trusted on its own.
  acknowledgedUninsured: z.boolean().optional(),
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
  lineItems?: QuoteLineKindLike[];
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
export const clientAcceptQuote = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, signatureDataUrl } = parsed.data;
  const acknowledgedUninsured = parsed.data.acknowledgedUninsured === true;

  const jobRef = db.doc(`jobs/${jobId}`);
  const quoteRef = db.doc(`quotes/${jobId}`);
  const waiverRef = db.doc(`insuranceWaivers/${jobId}`);

  // Record the signature BEFORE the transaction. If the upload fails we abort
  // (never accept with a signature that didn't land); the inverse order risks
  // an accepted-without-signature record. An orphan file on a rare precondition
  // failure is benign — the path is deterministic, so a retry overwrites it.
  let signaturePath: string;
  try {
    signaturePath = await writeQuoteSignature(jobId, signatureDataUrl);
  } catch (err) {
    logger.error("clientAcceptQuote signature upload failed", { jobId, clientId: uid, err });
    throw new HttpsError("internal", "Couldn't record your signature. Please try again.");
  }

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

    // Uninsured-work gate. Re-check the tradesperson's liability insurance from
    // the public mirror; if they're not currently insured, the client must have
    // ticked the disclosure. The acceptance signature doubles as the client's
    // recorded acknowledgment, kept in insuranceWaivers/{jobId}.
    const [tradieSnap, waiverSnap] = await Promise.all([
      tx.get(db.doc(`tradespeople/${job.tradespersonId}`)),
      tx.get(waiverRef),
    ]);
    const uninsured = !isTradieInsured(
      tradieSnap.data() as InsuranceStatusFields | undefined,
    );
    if (uninsured && !acknowledgedUninsured) {
      throw new HttpsError(
        "failed-precondition",
        "Please acknowledge that this tradesperson isn't currently insured before accepting.",
      );
    }

    const upfront = quote.upfrontFee ?? null;
    const requiresUpfrontPayment = upfront != null && upfront.amountCents > 0;

    // Lock in how this job is billed from the quote the client just agreed to.
    // Drives clock-in (fixed jobs track time at $0) for the rest of the job.
    const billingType = resolveBillingType(quote.lineItems);

    if (requiresUpfrontPayment) {
      tx.update(jobRef, {
        status: "awaiting_upfront_payment",
        billingType,
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
      tx.update(jobRef, { status: "in_progress", billingType });
    }
    tx.update(quoteRef, {
      status: "accepted",
      acceptedAt: FieldValue.serverTimestamp(),
      clientSignatureStoragePath: signaturePath,
      declinedReason: null,
    });

    // Record the client's uninsured-work acknowledgment. Create-or-merge so a
    // tradesperson waiver already on file (rare — they sign at clock-in, which
    // is after this) is never clobbered.
    if (uninsured) {
      const base = waiverSnap.exists
        ? {}
        : {
            jobId,
            clientId: uid,
            tradespersonId: job.tradespersonId,
            disclosureVersion: UNINSURED_DISCLOSURE_VERSION,
            reason: "no_liability_insurance",
            tradesperson: null,
            createdAt: FieldValue.serverTimestamp(),
          };
      tx.set(
        waiverRef,
        {
          ...base,
          client: {
            acknowledgedAt: FieldValue.serverTimestamp(),
            byUid: uid,
            signatureStoragePath: signaturePath,
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
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
