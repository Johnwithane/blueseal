import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";
import { CANCEL_REQUEST_STATUSES, POSTPONE_STATUSES } from "./requestJobChange";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  accept: z.boolean(),
});

interface PendingChange {
  type: "cancel" | "postpone";
  requestedBy: string;
  reason?: string;
  proposedResumeAt?: Timestamp | null;
}

interface JobData {
  clientId: string;
  tradespersonId: string;
  status: string;
  chatId: string;
  title?: string;
  pendingChange?: PendingChange | null;
}

function holdDate(ts: Timestamp | null | undefined): string {
  if (!ts) return "";
  // Canada-localised, Toronto-time — matches the rest of the user-facing copy.
  return ` until ${new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
  }).format(ts.toDate())}`;
}

/**
 * Tradesperson accepts or declines the client's pending cancel/postpone
 * request. Accepting is what actually moves the job:
 *   - cancel   → status "cancelled" (cancelledBy preserved as the requester).
 *   - postpone → status "on_hold", remembering statusBeforeHold for resume.
 * Declining just clears the request. We own the chat line + the client
 * notification here; onJobCancelled / onJobUpdated defer to us (they detect the
 * cleared pendingChange) so there's no double-notify.
 */
export const respondJobChange = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, accept } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = snap.data() as JobData;
    if (job.tradespersonId !== uid) throw new HttpsError("permission-denied", "Not your job.");
    const pc = job.pendingChange;
    if (!pc) throw new HttpsError("failed-precondition", "No pending request to respond to.");

    const base = {
      clientId: job.clientId,
      chatId: job.chatId,
      title: (job.title ?? "the job").slice(0, 60),
      type: pc.type,
      reason: pc.reason ?? "",
      resumeLabel: holdDate(pc.proposedResumeAt),
    };

    if (!accept) {
      tx.update(jobRef, { pendingChange: null });
      return { ...base, outcome: "declined" as const };
    }
    // The job may have moved on between the client's request and this accept
    // (e.g. the tradie invoiced and the client paid). Accepting now would
    // cancel or hold a finished job — clear the stale request instead.
    const stillEligible =
      pc.type === "cancel"
        ? CANCEL_REQUEST_STATUSES.includes(job.status)
        : POSTPONE_STATUSES.includes(job.status);
    if (!stillEligible) {
      tx.update(jobRef, { pendingChange: null });
      return { ...base, outcome: "stale" as const };
    }
    if (pc.type === "cancel") {
      tx.update(jobRef, {
        status: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledReason: pc.reason ?? "",
        cancelledBy: pc.requestedBy,
        pendingChange: null,
      });
      return { ...base, outcome: "accepted" as const };
    }
    // postpone — remember where to come back to.
    tx.update(jobRef, {
      status: "on_hold",
      statusBeforeHold: job.status,
      pendingChange: null,
    });
    return { ...base, outcome: "accepted" as const };
  });

  const isCancel = result.type === "cancel";

  // Stale request resolved silently — nothing changed for either party beyond
  // the banner disappearing, so no chat line or notification.
  if (result.outcome === "stale") {
    logger.info("respondJobChange stale request cleared", {
      jobId,
      tradespersonId: uid,
      type: result.type,
    });
    return { ok: true, stale: true };
  }

  // Chat line + client notification, fully owned here.
  if (result.outcome === "declined") {
    await postSystemMessage(
      result.chatId,
      `Tradesperson declined the client's request to ${isCancel ? "cancel the job" : "put the job on hold"}.`,
    );
    await notify({
      userId: result.clientId,
      type: "job_change_declined",
      title: `Request declined: ${result.title}`,
      body: isCancel
        ? "The tradesperson declined your cancellation request. The job continues as normal."
        : "The tradesperson declined your hold request. The job continues as normal.",
      link: `/jobs/${jobId}`,
      actorUid: uid,
      jobId,
      chatId: result.chatId ?? null,
      recipientRole: "client",
      priority: "normal",
    });
  } else if (isCancel) {
    const reasonTail = result.reason ? ` — "${result.reason}"` : "";
    await postSystemMessage(result.chatId, `Job cancelled${reasonTail}.`);
    await notify({
      userId: result.clientId,
      type: "job_change_accepted",
      title: `Cancellation accepted: ${result.title}`,
      body: "The tradesperson accepted your cancellation. The job is now cancelled.",
      link: `/jobs/${jobId}`,
      actorUid: uid,
      jobId,
      chatId: result.chatId ?? null,
      recipientRole: "client",
      priority: "high",
    });
  } else {
    await postSystemMessage(result.chatId, `Job placed on hold${result.resumeLabel}.`);
    await notify({
      userId: result.clientId,
      type: "job_change_accepted",
      title: `Hold accepted: ${result.title}`,
      body: `The tradesperson put the job on hold${result.resumeLabel}. Either of you can resume it when you're ready.`,
      link: `/jobs/${jobId}`,
      actorUid: uid,
      jobId,
      chatId: result.chatId ?? null,
      recipientRole: "client",
      priority: "high",
    });
  }

  logger.info("respondJobChange", {
    jobId,
    tradespersonId: uid,
    type: result.type,
    outcome: result.outcome,
  });
  return { ok: true };
});
