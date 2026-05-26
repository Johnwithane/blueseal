import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { recordSubmission } from "../lib/reviewPair";

interface ReviewLike {
  jobId?: string;
  clientId?: string;
  tradespersonId?: string;
  rating: number;
}

/**
 * Public review (client -> tradesperson) created. Delegates to the
 * mutual-review pair so:
 *   1. The pair gets stamped (`clientSubmittedAt` + `clientReviewId`).
 *   2. If the tradesperson already submitted theirs, revealPair fires —
 *      both reviews flip `revealedAt` and the tradie aggregate finally
 *      updates. Otherwise the tradesperson is nudged to leave theirs.
 *
 * Aggregation no longer happens here — it lives in lib/reviewPair.ts
 * `aggregateTradespersonRating`, which only runs at reveal. Keeping it
 * in the on-create trigger would leak the hidden client score via the
 * tradie's running average delta.
 */
export const onReviewCreated = onDocumentCreated("reviews/{reviewId}", async (event) => {
  const reviewId = event.params.reviewId;
  const r = event.data?.data() as ReviewLike | undefined;
  if (!r?.tradespersonId || !r.clientId || !r.jobId) {
    logger.warn("onReviewCreated: missing required ids; skipping", { reviewId });
    return;
  }
  try {
    await recordSubmission({
      jobId: r.jobId,
      clientId: r.clientId,
      tradespersonId: r.tradespersonId,
      reviewId,
      submittedBy: "client",
    });
  } catch (err) {
    logger.error("onReviewCreated: recordSubmission failed", { reviewId, err });
  }
});
