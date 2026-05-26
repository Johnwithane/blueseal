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

interface UpfrontFeeData {
  amountCents: number;
  source: "fixed" | "percent";
  paymentMethod: "manual" | "stripe";
  paidAt: unknown;
  paidBy: string | null;
  appliedInvoiceId: string | null;
}

interface JobData {
  tradespersonId: string;
  clientId: string;
  status: string;
  chatId: string;
  upfrontFee?: UpfrontFeeData | null;
}

/**
 * Client-initiated "I've paid the upfront fee" path. Mirrors
 * `clientMarkPaid` for final invoices: flips the upfront fee state to
 * paid (paidBy = "client_marked") and advances the job to in_progress.
 * Useful for asynchronous payment methods like e-transfer where the
 * client knows they've sent it before the tradesperson has confirmed
 * receipt. The tradesperson can re-mark via `markUpfrontFeePaid`
 * idempotently (transaction guards the status check).
 *
 * onJobUpdated suppresses its generic line on the awaiting_upfront_payment →
 * in_progress transition.
 */
export const clientMarkUpfrontFeePaid = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);

  const result = await db.runTransaction(async (tx) => {
    const jobSnap = await tx.get(jobRef);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;
    if (job.clientId !== uid) {
      throw new HttpsError("permission-denied", "Not your job.");
    }
    if (job.status !== "awaiting_upfront_payment") {
      throw new HttpsError(
        "failed-precondition",
        `Job must be awaiting upfront payment. Current: ${job.status}.`,
      );
    }
    const fee = job.upfrontFee;
    if (!fee || fee.amountCents <= 0) {
      throw new HttpsError("failed-precondition", "No upfront fee on this job.");
    }

    tx.update(jobRef, {
      status: "in_progress",
      "upfrontFee.paidAt": FieldValue.serverTimestamp(),
      "upfrontFee.paidBy": "client_marked",
    });
    return {
      tradespersonId: job.tradespersonId,
      chatId: job.chatId,
      amountCents: fee.amountCents,
    };
  });

  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Client confirmed paying the $${(result.amountCents / 100).toFixed(2)} upfront fee. Job is now active.`,
    );
  }

  await notify({
    userId: result.tradespersonId,
    type: "invoice_paid",
    title: "Client paid the upfront fee",
    body: `$${(result.amountCents / 100).toFixed(2)} marked paid. Job is active — work can start.`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    recipientRole: "tradesperson",
    priority: "high",
  });

  logger.info("clientMarkUpfrontFeePaid", {
    jobId,
    clientId: uid,
    amountCents: result.amountCents,
  });
  return { ok: true };
});
