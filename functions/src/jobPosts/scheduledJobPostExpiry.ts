import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";

/**
 * Daily scan: any open job post whose expiresAt has passed flips to "expired".
 * The onJobPostClosed trigger then fans out rejection notifications.
 */
export const scheduledJobPostExpiry = onSchedule(
  { schedule: "every day 03:00", timeZone: "America/Vancouver" },
  async () => {
    const now = Timestamp.now();
    const snap = await db
      .collection("jobPosts")
      .where("status", "==", "open")
      .where("expiresAt", "<=", now)
      .limit(500)
      .get();
    if (snap.empty) {
      logger.info("scheduledJobPostExpiry: nothing to expire");
      return;
    }
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        status: "expired",
        closedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    logger.info(`scheduledJobPostExpiry: expired ${snap.size} posts`);
  },
);
