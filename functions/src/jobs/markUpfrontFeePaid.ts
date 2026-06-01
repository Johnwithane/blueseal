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
 * Tradesperson confirms they've received the upfront fee (offline — etransfer,
 * cash, etc.). Mirrors `markJobPaid` for the final invoice: flips the upfront
 * fee state to paid and advances the job from awaiting_upfront_payment →
 * in_progress so work can start. When Stripe Connect is enabled the webhook
 * dispatcher will resolve this automatically with paidBy = "stripe"; this
 * manual callable remains as the override path for clients paying offline.
 *
 * onJobUpdated suppresses its generic line on the awaiting_upfront_payment →
 * in_progress transition because the message posted here is richer.
 */
export const markUpfrontFeePaid = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);

  const result = await db.runTransaction(async (tx) => {
    const jobSnap = await tx.get(jobRef);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;
    if (job.tradespersonId !== uid) {
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
      "upfrontFee.paidBy": "tradesperson_marked",
    });
    return {
      clientId: job.clientId,
      chatId: job.chatId,
      amountCents: fee.amountCents,
    };
  });

  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Upfront fee received ($${(result.amountCents / 100).toFixed(2)}). Job is now active — it'll be credited against the final invoice.`,
    );
  }

  await notify({
    userId: result.clientId,
    type: "invoice_paid",
    title: "Upfront fee received",
    body: `Thanks — $${(result.amountCents / 100).toFixed(2)} confirmed. Work can begin.`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    recipientRole: "client",
    priority: "normal",
  });

  logger.info("markUpfrontFeePaid", { jobId, tradespersonId: uid, amountCents: result.amountCents });
  return { ok: true };
});
