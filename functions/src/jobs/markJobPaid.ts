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
  clientId: string | null;
  status: string;
  chatId: string;
  acceptedOffline?: boolean;
}

interface InvoiceData {
  invoiceNumber: string;
  total: number;
  status: string;
}

/**
 * Tradesperson confirms the client has paid (offline — Stripe Connect comes
 * later, see design.md § 12). Flips both the invoice (→ paid) and the job
 * (→ complete) atomically so dashboards + the kanban + the client's
 * receipts list all agree.
 *
 * onJobUpdated suppresses its generic line on the awaiting_payment →
 * complete transition because we post a friendlier one here.
 */
export const markJobPaid = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const invoiceRef = db.doc(`invoices/${jobId}`);

  const result = await db.runTransaction(async (tx) => {
    const [jobSnap, invoiceSnap] = await Promise.all([tx.get(jobRef), tx.get(invoiceRef)]);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;
    if (job.tradespersonId !== uid) {
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
      clientId: job.clientId,
      chatId: job.chatId,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      acceptedOffline: job.acceptedOffline === true,
    };
  });

  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Payment received — invoice ${result.invoiceNumber} marked paid ($${(result.total / 100).toFixed(2)}). Job complete.`,
    );
  }

  await notify({
    userId: result.clientId,
    type: "invoice_sent",
    title: "Payment received",
    body: `${result.invoiceNumber} marked paid. Thanks!`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    recipientRole: "client",
    priority: "normal",
  });

  // Mutual-review loop — idempotent. Both this callable and clientMarkPaid
  // call ensureReviewPair so whichever closes the invoice first seeds the
  // 14-day window. Only fan the initial "leave a review" prompt out on
  // the create branch; if the pair already existed (because the client
  // marked paid moments earlier) the partner notification was already
  // sent there.
  //
  // Reputation firewall: never seed a pair for a job with no client party
  // (solo bring-your-own-client) or whose quote acceptance was recorded
  // offline by the tradesperson — there's no verified counterparty, so a
  // review here would be fabricable reputation. The reviews create rules
  // enforce the same gate server-side.
  if (result.clientId === null || result.acceptedOffline) {
    logger.info("markJobPaid: review pair skipped (solo/offline-accepted job)", { jobId });
    return { ok: true };
  }
  try {
    const { created } = await ensureReviewPair({
      jobId,
      clientId: result.clientId,
      tradespersonId: uid,
    });
    if (created) {
      const reviewLink = `/jobs/${jobId}`;
      await Promise.all([
        notify({
          userId: uid,
          type: "review_requested",
          title: "Leave a review for your client",
          body: "Reviews stay hidden until both of you submit. You have 14 days.",
          link: reviewLink,
          jobId,
          actorUid: result.clientId,
          recipientRole: "tradesperson",
          priority: "normal",
        }),
        notify({
          userId: result.clientId,
          type: "review_requested",
          title: "Leave a review for your tradesperson",
          body: "Reviews stay hidden until both of you submit. You have 14 days.",
          link: reviewLink,
          jobId,
          actorUid: uid,
          recipientRole: "client",
          priority: "normal",
        }),
      ]);
    }
  } catch (err) {
    // Non-fatal — the job/invoice transition already committed. The
    // scheduled nudge will fill in for a missed initial fan-out.
    logger.error("markJobPaid: review-pair seed failed", { jobId, err });
  }

  logger.info("markJobPaid", { jobId, tradespersonId: uid, invoiceNumber: result.invoiceNumber });
  return { ok: true };
});
