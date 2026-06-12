import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
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
  clientId: string | null;
  status: string;
  chatId: string;
}

/**
 * Client "I've paid this invoice" — a NUDGE, not a state change.
 *
 * Cash-policy decision (2026-06-11): the tradesperson's confirmation is
 * authoritative for offline payment. A client saying they've paid no longer
 * flips the job/invoice to complete/paid — it pings the tradesperson to confirm
 * receipt (via markJobPaid), which is what actually completes the job and seeds
 * the review pair + receipt. This prevents a client from closing a job on an
 * unverified "I paid". Card payments settle automatically through Stripe.
 */
export const clientMarkPaid = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId } = parsed.data;

  const jobSnap = await db.doc(`jobs/${jobId}`).get();
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

  if (job.chatId) {
    await postSystemMessage(
      job.chatId,
      "The client says they've sent payment. Tradesperson — confirm you've received it to complete the job.",
    );
  }

  await notify({
    userId: job.tradespersonId,
    type: "invoice_sent",
    title: "Client says they've paid",
    body: "Confirm you've received payment to mark the job complete.",
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: job.chatId ?? null,
    recipientRole: "tradesperson",
    priority: "high",
  });

  logger.info("clientMarkPaid (nudge)", { jobId, clientId: uid });
  return { ok: true };
});
