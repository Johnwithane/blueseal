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
export const markJobPaid = onCall({ enforceAppCheck: false }, async (req) => {
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

  logger.info("markJobPaid", { jobId, tradespersonId: uid, invoiceNumber: result.invoiceNumber });
  return { ok: true };
});
