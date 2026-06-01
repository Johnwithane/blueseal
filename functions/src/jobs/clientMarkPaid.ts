import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";
import { ensureReviewPair } from "../lib/reviewPair";

const Input = z.object({
  jobId: z.string().min(1).max(128),
});

interface JobData {
  tradespersonId: string;
  clientId: string;
  status: string;
  chatId: string;
}

interface InvoiceData {
  invoiceNumber: string;
  total: number;
  status: string;
}

/**
 * Client-initiated "I've paid this invoice" path. Pre-Stripe-Connect we
 * support fully-offline payment (e-transfer, cash, etc.), so either party
 * can close the loop — the tradesperson via `markJobPaid`, the client via
 * this callable.
 *
 * Atomically flips the invoice (→ paid) and the job (→ complete), same as
 * `markJobPaid`, with the auth check inverted (client role instead of
 * tradesperson). When Stripe Connect is live this becomes a no-op for the
 * client (the Stripe Elements flow takes over) — leave it deployed for
 * legacy manual-flow invoices and as a fallback for tradies who collect
 * outside Stripe (e.g. e-transfer for repeat customers).
 *
 * onJobUpdated suppresses its generic line on the awaiting_payment →
 * complete transition because we post a friendlier one here.
 */
export const clientMarkPaid = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const invoiceRef = db.doc(`invoices/${jobId}`);

  const result = await db.runTransaction(async (tx) => {
    const [jobSnap, invoiceSnap] = await Promise.all([tx.get(jobRef), tx.get(invoiceRef)]);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;
    if (job.clientId !== uid) {
      throw new HttpsError("permission-denied", "Not your job.");
    }
    if (job.status !== "awaiting_payment") {
      throw new HttpsError(
        "failed-precondition",
        `Job must be awaiting payment. Current status: ${job.status}.`,
      );
    }
    if (!invoiceSnap.exists) {
      throw new HttpsError("not-found", "Invoice not found.");
    }
    const invoice = invoiceSnap.data() as InvoiceData;

    tx.update(jobRef, {
      status: "complete",
      completedAt: FieldValue.serverTimestamp(),
    });
    if (invoice.status !== "paid") {
      tx.update(invoiceRef, {
        status: "paid",
        paidAt: FieldValue.serverTimestamp(),
      });
    }
    return {
      tradespersonId: job.tradespersonId,
      chatId: job.chatId,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
    };
  });

  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Client confirmed payment for ${result.invoiceNumber} ($${(result.total / 100).toFixed(2)}). Job complete.`,
    );
  }

  await notify({
    userId: result.tradespersonId,
    type: "invoice_paid",
    title: "Client confirmed payment",
    body: `${result.invoiceNumber} marked paid ($${(result.total / 100).toFixed(2)}).`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    recipientRole: "tradesperson",
    priority: "normal",
  });

  // Mutual-review loop — same contract as markJobPaid (the other invoice-
  // paid callable). ensureReviewPair is idempotent; we only fire the
  // initial fan-out on the create branch so we don't double-prompt when
  // both callables race.
  try {
    const { created } = await ensureReviewPair({
      jobId,
      clientId: uid,
      tradespersonId: result.tradespersonId,
    });
    if (created) {
      const reviewLink = `/jobs/${jobId}`;
      await Promise.all([
        notify({
          userId: result.tradespersonId,
          type: "review_requested",
          title: "Leave a review for your client",
          body: "Reviews stay hidden until both of you submit. You have 14 days.",
          link: reviewLink,
          jobId,
          actorUid: uid,
          recipientRole: "tradesperson",
          priority: "normal",
        }),
        notify({
          userId: uid,
          type: "review_requested",
          title: "Leave a review for your tradesperson",
          body: "Reviews stay hidden until both of you submit. You have 14 days.",
          link: reviewLink,
          jobId,
          actorUid: result.tradespersonId,
          recipientRole: "client",
          priority: "normal",
        }),
      ]);
    }
  } catch (err) {
    logger.error("clientMarkPaid: review-pair seed failed", { jobId, err });
  }

  logger.info("clientMarkPaid", { jobId, clientId: uid, invoiceNumber: result.invoiceNumber });
  return { ok: true };
});
