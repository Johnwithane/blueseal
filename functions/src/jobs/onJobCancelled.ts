import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { notify } from "../lib/notify";

interface JobLike {
  clientId?: string;
  tradespersonId?: string;
  title?: string;
  status?: string;
  cancelledBy?: string | null;
  cancelledReason?: string | null;
}

/**
 * Notify the opposite party when a job is cancelled by one of the
 * participants. `cancelledBy` is set by the client- or tradie-initiated
 * cancellation paths (cancelJob service, status dropdown). The sentinel
 * value "system" is used by returnToApplicants to suppress this trigger —
 * that flow already sends an `application_returned` notification.
 */
export const onJobCancelled = onDocumentUpdated("jobs/{jobId}", async (event) => {
  const before = event.data?.before.data() as JobLike | undefined;
  const after = event.data?.after.data() as JobLike | undefined;
  if (!before || !after) return;
  if (before.status === "cancelled") return; // already cancelled
  if (after.status !== "cancelled") return;
  if (after.cancelledBy === "system") {
    // returnToApplicants already fired application_returned — don't double-notify.
    return;
  }

  const jobId = event.params.jobId;
  const { clientId, tradespersonId, title, cancelledBy, cancelledReason } = after;
  if (!clientId || !tradespersonId) {
    logger.warn("onJobCancelled: missing party uids", { jobId });
    return;
  }

  // Notify the OPPOSITE party. If cancelledBy is missing (legacy path
  // before the field was added), fall back to notifying both.
  const recipients: string[] = [];
  if (!cancelledBy) {
    recipients.push(clientId, tradespersonId);
  } else if (cancelledBy === clientId) {
    recipients.push(tradespersonId);
  } else if (cancelledBy === tradespersonId) {
    recipients.push(clientId);
  } else {
    // Unknown actor (admin? script?) — notify both parties so nobody is left wondering.
    recipients.push(clientId, tradespersonId);
  }

  const safeTitle = (title ?? "your job").slice(0, 80);
  const reasonClause = cancelledReason ? `Reason: "${cancelledReason}"` : "No reason was given.";

  await Promise.all(
    recipients.map((userId) =>
      notify({
        userId,
        type: "job_cancelled",
        title: `Job cancelled: ${safeTitle}`,
        body: reasonClause,
        link: `/jobs/${jobId}`,
        jobId,
        actorUid: cancelledBy ?? null,
        // High priority: the other party may be relying on this — a tradie
        // could be en route, a client may have blocked off the day. The
        // bell, email, and WhatsApp together make sure they catch it.
        priority: "high",
      }),
    ),
  );
});
