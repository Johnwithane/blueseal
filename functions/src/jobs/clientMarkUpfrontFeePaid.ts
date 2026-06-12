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

interface UpfrontFeeData {
  amountCents: number;
  paidAt: unknown;
}

interface JobData {
  tradespersonId: string;
  clientId: string | null;
  status: string;
  chatId: string;
  upfrontFee?: UpfrontFeeData | null;
}

/**
 * Client "I've paid the upfront fee" — a NUDGE, not a state change.
 *
 * Cash-policy decision (2026-06-11): the tradesperson confirms receipt of the
 * deposit (via markUpfrontFeePaid), which is what advances the job to
 * in_progress. A client claiming they paid shouldn't start work on an
 * unconfirmed deposit, so this just pings the tradesperson. Card payment of the
 * upfront fee settles automatically through Stripe.
 */
export const clientMarkUpfrontFeePaid = onCall(CALLABLE_OPTS, async (req) => {
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
  if (job.status !== "awaiting_upfront_payment") {
    throw new HttpsError(
      "failed-precondition",
      `Job must be awaiting upfront payment. Current: ${job.status}.`,
    );
  }

  if (job.chatId) {
    await postSystemMessage(
      job.chatId,
      "The client says they've sent the upfront fee. Tradesperson — confirm you've received it to start work.",
    );
  }

  await notify({
    userId: job.tradespersonId,
    type: "invoice_sent",
    title: "Client says they've paid the upfront fee",
    body: "Confirm you've received it to start work on the job.",
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: job.chatId ?? null,
    recipientRole: "tradesperson",
    priority: "high",
  });

  logger.info("clientMarkUpfrontFeePaid (nudge)", { jobId, clientId: uid });
  return { ok: true };
});
