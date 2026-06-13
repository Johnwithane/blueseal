import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { enqueueMail } from "../lib/mail";
import { brandedEmailHtml } from "../lib/emailTemplate";
import { notify } from "../lib/notify";
import { seedReviewPairAndNotify } from "../lib/reviewPair";

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://blueseal.app").replace(/\/$/, "");
}

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

  // Auto-receipt: email the client a paid-receipt confirmation so an
  // offline-paid (cash / e-transfer) job feels as documented as a card one.
  // Best-effort — a mail miss must not roll back the completed job. Skipped on
  // solo bring-your-own-client jobs (no claimed client to email).
  if (result.clientId) {
    try {
      const [clientUser, tradieUser, invSnap] = await Promise.all([
        db.doc(`users/${result.clientId}`).get(),
        db.doc(`users/${uid}`).get(),
        invoiceRef.get(),
      ]);
      const clientEmail = (clientUser.data() as { email?: string })?.email;
      const clientName = (clientUser.data() as { displayName?: string })?.displayName ?? "there";
      const tradieName =
        (tradieUser.data() as { displayName?: string })?.displayName ?? "your tradesperson";
      const pdfUrl = (invSnap.data() as { pdfUrl?: string | null })?.pdfUrl ?? null;
      if (clientEmail) {
        const amount = `$${(result.total / 100).toFixed(2)}`;
        const receiptUrl = `${appBaseUrl()}/invoices/${jobId}/receipt`;
        await enqueueMail({
          to: clientEmail,
          subject: `Receipt — invoice ${result.invoiceNumber} paid`,
          // Plain-text part kept as the multipart fallback for clients that
          // don't render HTML.
          text:
            `Hi ${clientName},\n\n` +
            `This confirms your payment of ${amount} to ${tradieName} ` +
            `for invoice ${result.invoiceNumber}.\n\n` +
            `View receipt: ${receiptUrl}\n` +
            (pdfUrl ? `Invoice PDF: ${pdfUrl}\n` : "") +
            `\nThanks,\nBlue Seal`,
          html: brandedEmailHtml({
            title: `Payment confirmed — invoice ${result.invoiceNumber}`,
            bodyLines: [
              `Hi ${clientName},`,
              `This confirms your payment of ${amount} to ${tradieName} for invoice ${result.invoiceNumber}.`,
              `Thanks for using Blue Seal — your receipt is ready below.`,
            ],
            ctaLabel: "View receipt",
            ctaUrl: receiptUrl,
            preheader: `Your ${amount} payment for invoice ${result.invoiceNumber} is confirmed.`,
          }),
        });
      }
    } catch (err) {
      logger.warn("markJobPaid: receipt email failed", { jobId, err });
    }
  }

  // Mutual-review loop — seed the pair + fan out the initial prompts. Shared
  // with the in-app card webhook (seedReviewPairAndNotify) so the loop fires the
  // same way however the invoice got paid. Idempotent + skips solo/offline-
  // accepted jobs (reputation firewall).
  await seedReviewPairAndNotify({
    jobId,
    clientId: result.clientId,
    tradespersonId: uid,
    acceptedOffline: result.acceptedOffline,
  });

  logger.info("markJobPaid", { jobId, tradespersonId: uid, invoiceNumber: result.invoiceNumber });
  return { ok: true };
});
