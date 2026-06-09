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

interface JobData {
  clientId: string;
  tradespersonId: string;
  status: string;
  chatId: string;
  title?: string;
  statusBeforeHold?: string | null;
}

/**
 * Take a held job off hold. By design (confirmed with the product owner) this
 * needs no counterparty acceptance — either party can resume — so the job just
 * returns to whatever status it held before the pause (in_progress in every
 * realistic case). Notifies the OTHER party so they know work is live again.
 */
export const resumeJob = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = snap.data() as JobData;
    if (job.clientId !== uid && job.tradespersonId !== uid) {
      throw new HttpsError("permission-denied", "Not your job.");
    }
    if (job.status !== "on_hold") {
      throw new HttpsError("failed-precondition", "This job isn't on hold.");
    }
    // Fall back to in_progress for the (theoretical) legacy hold with no
    // remembered status, so a resume can never strand the job in on_hold.
    const restore = job.statusBeforeHold ?? "in_progress";
    tx.update(jobRef, { status: restore, statusBeforeHold: null });
    const recipient = job.clientId === uid ? job.tradespersonId : job.clientId;
    return {
      recipient,
      recipientRole: (job.clientId === uid ? "tradesperson" : "client") as
        | "client"
        | "tradesperson",
      chatId: job.chatId,
      title: (job.title ?? "the job").slice(0, 60),
    };
  });

  await postSystemMessage(result.chatId, "Job resumed — work is active again.");

  await notify({
    userId: result.recipient,
    type: "job_resumed",
    title: `Job resumed: ${result.title}`,
    body: "The job is off hold and active again.",
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    recipientRole: result.recipientRole,
    priority: "normal",
  });

  logger.info("resumeJob", { jobId, actorUid: uid });
  return { ok: true };
});
