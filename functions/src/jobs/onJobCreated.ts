import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { notify } from "../lib/notify";

interface JobLike {
  clientId?: string;
  tradespersonId?: string;
  title?: string;
  trade?: string;
  status?: string;
  sourcePostId?: string | null;
  claimOriginated?: boolean;
  inviteOriginated?: boolean;
  urgency?: "flexible" | "this_week" | "urgent";
}

/**
 * Notify the tradesperson when a new direct-request job lands in their
 * queue. Marketplace conversions (sourcePostId != null) are skipped —
 * acceptApplication already fired the "you were selected" notification, so
 * notifying again here would double-page the tradie. Prospect-claim
 * conversions (claimOriginated) are skipped too — claimProspect sends a single
 * "N customers are waiting" summary instead of one page per converted lead.
 */
export const onJobCreated = onDocumentCreated("jobs/{jobId}", async (event) => {
  const job = event.data?.data() as JobLike | undefined;
  if (!job?.tradespersonId) return;
  if (job.sourcePostId) return; // marketplace-converted; already notified
  if (job.claimOriginated) return; // prospect-claim; summary sent by claimProspect
  if (job.inviteOriginated) return; // tradesperson created it themselves; paging them is noise

  const jobId = event.params.jobId;
  const title = job.title ?? "a job";
  const isUrgent = job.urgency === "urgent";

  try {
    await notify({
      userId: job.tradespersonId,
      type: "job_requested",
      title: isUrgent ? "Urgent job request" : "New job request",
      body: `A client requested you for "${title}"${job.trade ? ` (${job.trade})` : ""}. Tap to review.`,
      link: `/jobs/${jobId}`,
      jobId,
      actorUid: job.clientId ?? null,
      recipientRole: "tradesperson",
      // High priority: tradespeople churn fast when leads sit unseen.
      priority: "high",
    });
  } catch (err) {
    logger.error("onJobCreated notify failed", { jobId, err });
  }
});
