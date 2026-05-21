import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "../lib/admin";

interface ClientReviewLike {
  clientId: string;
  rating: number;
}

export const onClientReviewCreated = onDocumentCreated(
  "clientReviews/{reviewId}",
  async (event) => {
    const r = event.data?.data() as ClientReviewLike | undefined;
    if (!r?.clientId) return;
    const userRef = db.doc(`users/${r.clientId}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return;
      const data = snap.data() as { clientRatingAvg: number; clientRatingCount: number };
      const newCount = (data.clientRatingCount ?? 0) + 1;
      const newAvg = ((data.clientRatingAvg ?? 0) * (data.clientRatingCount ?? 0) + r.rating) / newCount;
      tx.update(userRef, { clientRatingAvg: newAvg, clientRatingCount: newCount });
    });
  },
);
