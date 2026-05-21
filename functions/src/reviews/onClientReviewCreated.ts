import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";

interface ClientReviewLike {
  clientId: string;
  rating: number;
}

function isValidScore(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 5;
}

export const onClientReviewCreated = onDocumentCreated(
  "clientReviews/{reviewId}",
  async (event) => {
    const r = event.data?.data() as ClientReviewLike | undefined;
    if (!r?.clientId) {
      logger.warn("Client review missing clientId", { reviewId: event.params.reviewId });
      return;
    }
    if (!isValidScore(r.rating)) {
      logger.warn("Client review rating out of bounds; skipping aggregate", {
        reviewId: event.params.reviewId,
        rating: r.rating,
      });
      return;
    }
    const userRef = db.doc(`users/${r.clientId}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        logger.warn("Client review references missing user", {
          reviewId: event.params.reviewId,
          clientId: r.clientId,
        });
        return;
      }
      const data = snap.data() as { clientRatingAvg: number; clientRatingCount: number };
      const newCount = (data.clientRatingCount ?? 0) + 1;
      const newAvg = ((data.clientRatingAvg ?? 0) * (data.clientRatingCount ?? 0) + r.rating) / newCount;
      tx.update(userRef, { clientRatingAvg: newAvg, clientRatingCount: newCount });
    });
  },
);
