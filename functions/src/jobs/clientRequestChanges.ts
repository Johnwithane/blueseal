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
  reason: z.string().trim().min(1).max(1000),
});

interface JobData {
  tradespersonId: string;
  clientId: string;
  status: string;
  chatId: string;
}

/**
 * Client kicks the wrap-up back to the tradesperson — they want something
 * changed before they'll approve. Reverts the job to in_progress (the
 * tradesperson can re-finish once they've adjusted) and posts the reason
 * into the job chat so the discussion thread has it on the record.
 *
 * clientApprovalRequestedAt is cleared and clientChangesRequestedAt/Reason
 * are stamped so the tradesperson-side UI can render a "changes requested"
 * banner + flip the sticky CTA from "Create invoice" to "Update invoice".
 * Both fields get cleared again on the next submitJobForApproval. The
 * invoice draft is preserved as-is — the tradesperson can edit it in
 * place rather than rebuild from scratch.
 *
 * onJobUpdated suppresses its generic status-changed line here.
 */
export const clientRequestChanges = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, reason } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);

  const result = await db.runTransaction(async (tx) => {
    const jobSnap = await tx.get(jobRef);
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
    tx.update(jobRef, {
      status: "in_progress",
      clientApprovalRequestedAt: null,
      clientChangesRequestedAt: FieldValue.serverTimestamp(),
      clientChangesRequestedReason: reason,
    });
    return { tradespersonId: job.tradespersonId, chatId: job.chatId };
  });

  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Client requested changes — "${reason}"`,
    );
  }

  await notify({
    userId: result.tradespersonId,
    type: "invoice_sent",
    title: "Client requested changes",
    body: reason.length > 200 ? reason.slice(0, 197) + "..." : reason,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    recipientRole: "tradesperson",
    priority: "high",
  });

  logger.info("clientRequestChanges", { jobId, clientId: uid });
  return { ok: true };
});
