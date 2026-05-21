import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";

interface ReviewLike {
  tradespersonId: string;
  rating: number;
  dimensions?: {
    quality: number;
    punctuality: number;
    communication: number;
    value: number;
  };
}

const DIM_KEYS = ["quality", "punctuality", "communication", "value"] as const;

function isValidScore(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 5;
}

/**
 * Recompute aggregates on the tradie doc. Single-doc transaction prevents
 * race conditions when multiple reviews come in close together.
 */
export const onReviewCreated = onDocumentCreated("reviews/{reviewId}", async (event) => {
  const r = event.data?.data() as ReviewLike | undefined;
  if (!r?.tradespersonId) {
    logger.warn("Review missing tradespersonId", { reviewId: event.params.reviewId });
    return;
  }
  if (!isValidScore(r.rating)) {
    logger.warn("Review rating out of bounds; skipping aggregate", {
      reviewId: event.params.reviewId,
      rating: r.rating,
    });
    return;
  }

  const tradieRef = db.doc(`tradespeople/${r.tradespersonId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(tradieRef);
    if (!snap.exists) {
      logger.warn("Review references missing tradesperson", {
        reviewId: event.params.reviewId,
        tradespersonId: r.tradespersonId,
      });
      return;
    }
    const data = snap.data() as {
      ratingAvg: number;
      ratingCount: number;
      ratingDimensions: Record<string, { avg: number; count: number }>;
    };
    const newCount = (data.ratingCount ?? 0) + 1;
    const newAvg = ((data.ratingAvg ?? 0) * (data.ratingCount ?? 0) + r.rating) / newCount;

    // Lock to the documented dimensions only; ignore extra/forged keys.
    const dims: Record<string, { avg: number; count: number }> = {
      ...(data.ratingDimensions ?? {}),
    };
    if (r.dimensions) {
      for (const k of DIM_KEYS) {
        const score = r.dimensions[k];
        if (!isValidScore(score)) continue;
        const prev = dims[k] ?? { avg: 0, count: 0 };
        const next = prev.count + 1;
        dims[k] = {
          avg: (prev.avg * prev.count + score) / next,
          count: next,
        };
      }
    }
    tx.update(tradieRef, {
      ratingAvg: newAvg,
      ratingCount: newCount,
      ratingDimensions: dims,
      lastReviewAt: FieldValue.serverTimestamp(),
    });
  });
});
