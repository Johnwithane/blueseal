import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { GOOGLE_SECRETS, isConfigured } from "./config";
import { syncReviewsForTradie } from "./sync";

/**
 * Daily refresh of every connected tradesperson's cached Google reviews so the
 * public profile stays current without anyone clicking "Sync now". Queries on
 * the public `googleReviews.connected` flag (auto-indexed single field — no
 * composite index needed). Each tradie is synced independently; one failure is
 * recorded on that tradie's snapshot and the loop continues.
 */
export const scheduledGoogleReviewsSync = onSchedule(
  { schedule: "every day 04:00", timeZone: "America/Vancouver", secrets: GOOGLE_SECRETS },
  async () => {
    if (!isConfigured()) {
      logger.info("scheduledGoogleReviewsSync: skipped (not configured)");
      return;
    }
    const snap = await db
      .collection("tradespeople")
      .where("googleReviews.connected", "==", true)
      .get();
    if (snap.empty) {
      logger.info("scheduledGoogleReviewsSync: no connected tradespeople");
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const doc of snap.docs) {
      const result = await syncReviewsForTradie(doc.id);
      if (result.error) failed += 1;
      else ok += 1;
    }
    logger.info(`scheduledGoogleReviewsSync: synced ${ok}, failed ${failed}`);
  },
);
