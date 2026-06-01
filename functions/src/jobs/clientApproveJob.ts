import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
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
 * Client signs off on the finished work. Atomically transitions the job to
 * awaiting_payment and the invoice from draft to sent, so the client now
 * sees the invoice + payment instructions and the tradesperson is told to
 * stand by for payment.
 *
 * Does NOT regenerate or email the PDF — keeping this lean for v1; the
 * tradesperson can still trigger the existing sendInvoice callable from
 * the invoice editor if they want a formal PDF + email.
 *
 * onJobUpdated suppresses its generic status-changed line for this
 * transition because we post a richer message here.
 */
export const clientApproveJob = onCall(CALLABLE_OPTS, async (req) => {
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
    if (job.status !== "awaiting_client_approval") {
      throw new HttpsError(
        "failed-precondition",
        `Job must be awaiting approval. Current status: ${job.status}.`,
      );
    }
    if (!invoiceSnap.exists) {
      throw new HttpsError("not-found", "Invoice not found — ask the tradesperson to re-finish the job.");
    }
    const invoice = invoiceSnap.data() as InvoiceData;
    if (invoice.total <= 0) {
      throw new HttpsError("failed-precondition", "Invoice has zero total.");
    }

    tx.update(jobRef, {
      status: "awaiting_payment",
      clientApprovedAt: FieldValue.serverTimestamp(),
    });
    // Mark the invoice sent only if still in draft — guard against a late
    // sendInvoice call having already moved it forward.
    if (invoice.status === "draft") {
      tx.update(invoiceRef, {
        status: "sent",
        sentAt: FieldValue.serverTimestamp(),
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
      `Client approved the work — invoice ${result.invoiceNumber} sent ($${(result.total / 100).toFixed(2)}).`,
    );
  }

  await notify({
    userId: result.tradespersonId,
    type: "invoice_sent",
    title: "Client approved your work",
    body: `Invoice ${result.invoiceNumber} ($${(result.total / 100).toFixed(2)}) is now awaiting payment.`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    recipientRole: "tradesperson",
    priority: "high",
  });

  logger.info("clientApproveJob", { jobId, clientId: uid, invoiceNumber: result.invoiceNumber });
  return { ok: true };
});
