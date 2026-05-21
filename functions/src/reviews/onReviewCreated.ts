import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
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

/**
 * Recompute aggregates on the tradie doc. Single-doc transaction prevents
 * race conditions when multiple reviews come in close together.
 */
export const onReviewCreated = onDocumentCreated("reviews/{reviewId}", async (event) => {
  const r = event.data?.data() as ReviewLike | undefined;
  if (!r?.tradespersonId) return;

  const tradieRef = db.doc(`tradespeople/${r.tradespersonId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(tradieRef);
    if (!snap.exists) return;
    const data = snap.data() as {
      ratingAvg: number;
      ratingCount: number;
      ratingDimensions: Record<string, { avg: number; count: number }>;
    };
    const newCount = (data.ratingCount ?? 0) + 1;
    const newAvg = ((data.ratingAvg ?? 0) * (data.ratingCount ?? 0) + r.rating) / newCount;

    const dims = { ...(data.ratingDimensions ?? {}) };
    if (r.dimensions) {
      for (const k of Object.keys(r.dimensions) as Array<keyof typeof r.dimensions>) {
        const prev = dims[k] ?? { avg: 0, count: 0 };
        const next = prev.count + 1;
        dims[k] = {
          avg: (prev.avg * prev.count + r.dimensions[k]) / next,
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
