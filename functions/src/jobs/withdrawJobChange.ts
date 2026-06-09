import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";

const Input = z.object({
  jobId: z.string().min(1).max(128),
});

interface PendingChange {
  type: "cancel" | "postpone";
  requestedBy: string;
}

interface JobData {
  clientId: string;
  tradespersonId: string;
  chatId: string;
  title?: string;
  pendingChange?: PendingChange | null;
}

/**
 * The party who raised a cancel/postpone request retracts it before the other
 * side has responded. Keeps the client from being stuck waiting if their plans
 * change again. Only the original requester may withdraw.
 */
export const withdrawJobChange = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = snap.data() as JobData;
    const pc = job.pendingChange;
    if (!pc) throw new HttpsError("failed-precondition", "There's no pending request to withdraw.");
    if (pc.requestedBy !== uid) {
      throw new HttpsError("permission-denied", "Only the requester can withdraw this.");
    }
    tx.update(jobRef, { pendingChange: null });
    // Notify the OTHER party (the one who was asked to respond).
    const recipient = job.clientId === uid ? job.tradespersonId : job.clientId;
    return {
      recipient,
      recipientRole: (job.clientId === uid ? "tradesperson" : "client") as
        | "client"
        | "tradesperson",
      chatId: job.chatId,
      title: (job.title ?? "the job").slice(0, 60),
      type: pc.type,
    };
  });

  await postSystemMessage(
    result.chatId,
    `Client withdrew their request to ${result.type === "cancel" ? "cancel the job" : "put the job on hold"}.`,
  );

  await notify({
    userId: result.recipient,
    type: "job_change_withdrawn",
    title: `Request withdrawn: ${result.title}`,
    body: `The ${result.type === "cancel" ? "cancellation" : "hold"} request was withdrawn — nothing more to do.`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    recipientRole: result.recipientRole,
    // Low-stakes courtesy — in-app inbox only, no email/WhatsApp.
    priority: "low",
  });

  logger.info("withdrawJobChange", { jobId, requestedBy: uid, type: result.type });
  return { ok: true };
});
