import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  type: z.enum(["cancel", "postpone"]),
  reason: z.string().trim().max(1000).default(""),
  // postpone only — epoch ms (UTC midnight) the client proposes resuming on.
  // Informational; surfaced in the request, not a scheduling commitment.
  proposedResumeAt: z.number().int().positive().nullish(),
});

interface JobData {
  clientId: string;
  tradespersonId: string;
  status: string;
  chatId: string;
  title?: string;
  pendingChange?: unknown;
}

// Committed statuses where the client must ASK rather than act unilaterally.
// Pre-commitment statuses (accepted/requested/quoted) still cancel instantly
// via the cancelJob client write. Kept in sync with REQUEST_CANCEL_STATUSES /
// POSTPONABLE_STATUSES in src/firebase/services/jobs.ts.
const CANCEL_REQUEST_STATUSES = ["awaiting_upfront_payment", "in_progress"];
const POSTPONE_STATUSES = ["in_progress"];

/**
 * Client asks to cancel or put a committed job on hold. We only stage the
 * request here (job.pendingChange); the tradesperson accepts/declines via
 * respondJobChange, and only then does the status actually change. This is the
 * "tradesperson must agree once work is committed" half of the flow — early,
 * pre-commitment cancellations stay instant (cancelJob + rules).
 */
export const requestJobChange = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, type, reason, proposedResumeAt } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = snap.data() as JobData;
    if (job.clientId !== uid) throw new HttpsError("permission-denied", "Not your job.");
    if (job.pendingChange) {
      throw new HttpsError(
        "failed-precondition",
        "There's already a pending request on this job.",
      );
    }
    const allowed = type === "cancel" ? CANCEL_REQUEST_STATUSES : POSTPONE_STATUSES;
    if (!allowed.includes(job.status)) {
      throw new HttpsError(
        "failed-precondition",
        `Can't ${type === "cancel" ? "request cancellation of" : "put on hold"} a job in status "${job.status}".`,
      );
    }
    tx.update(jobRef, {
      pendingChange: {
        type,
        requestedBy: uid,
        requestedAt: FieldValue.serverTimestamp(),
        reason,
        proposedResumeAt:
          type === "postpone" && proposedResumeAt != null
            ? Timestamp.fromMillis(proposedResumeAt)
            : null,
      },
    });
    return {
      tradespersonId: job.tradespersonId,
      chatId: job.chatId,
      title: (job.title ?? "the job").slice(0, 60),
    };
  });

  const verb = type === "cancel" ? "cancel this job" : "put this job on hold";
  const reasonTail = reason ? ` — "${reason}"` : "";
  await postSystemMessage(
    result.chatId,
    `Client requested to ${verb}${reasonTail}. Awaiting your response.`,
  );

  await notify({
    userId: result.tradespersonId,
    type: "job_change_requested",
    title:
      type === "cancel"
        ? `Cancellation requested: ${result.title}`
        : `Hold requested: ${result.title}`,
    body: reason
      ? `Reason: "${reason}"`
      : type === "cancel"
        ? "The client asked to cancel this job. Open it to accept or decline."
        : "The client asked to put this job on hold. Open it to accept or decline.",
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    recipientRole: "tradesperson",
    // Time-sensitive: the tradie may be about to do work / travel. Page them.
    priority: "high",
  });

  logger.info("requestJobChange", { jobId, clientId: uid, type });
  return { ok: true };
});
