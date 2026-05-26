import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { recordSubmission } from "../lib/reviewPair";

interface ClientReviewLike {
  jobId?: string;
  clientId?: string;
  tradespersonId?: string;
  rating: number;
}

/**
 * Private review (tradesperson -> client) created. Symmetric to
 * onReviewCreated — delegates to the reviewPair so the mutual-blind
 * reveal can fire when (and only when) both sides have submitted.
 *
 * Aggregation of clientRatingAvg / clientRatingCount happens at reveal
 * time inside lib/reviewPair.ts (aggregateClientRating); keep this
 * trigger thin so the reveal logic stays in one place.
 */
export const onClientReviewCreated = onDocumentCreated(
  "clientReviews/{reviewId}",
  async (event) => {
    const reviewId = event.params.reviewId;
    const r = event.data?.data() as ClientReviewLike | undefined;
    if (!r?.clientId || !r.tradespersonId || !r.jobId) {
      logger.warn("onClientReviewCreated: missing required ids; skipping", {
        reviewId,
      });
      return;
    }
    try {
      await recordSubmission({
        jobId: r.jobId,
        clientId: r.clientId,
        tradespersonId: r.tradespersonId,
        reviewId,
        submittedBy: "tradesperson",
      });
    } catch (err) {
      logger.error("onClientReviewCreated: recordSubmission failed", { reviewId, err });
    }
  },
);
