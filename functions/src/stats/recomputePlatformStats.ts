import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";

// Public marketing counts for the /pitch investor deck. COUNTS ONLY — no
// personal data ever lands in platformStats/current (world-readable per
// firestore.rules). Mirrors the scheduledOverdue pattern; uses aggregate
// count() so it stays cheap as the collections grow (one read per ~1000 docs,
// not a full scan).
const COMPLETED_STATUSES = ["complete", "reviewed"];

export const recomputePlatformStats = onSchedule("every 6 hours", async () => {
  const [verified, jobsTotal, jobsDone] = await Promise.all([
    db
      .collection("tradespeople")
      .where("isVisible", "==", true)
      .where("vettingStatus", "==", "approved")
      .count()
      .get(),
    db.collection("jobs").count().get(),
    db.collection("jobs").where("status", "in", COMPLETED_STATUSES).count().get(),
  ]);

  const stats = {
    verifiedPros: verified.data().count,
    jobs: jobsTotal.data().count,
    jobsCompleted: jobsDone.data().count,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db.collection("platformStats").doc("current").set(stats);
  logger.info("platformStats recomputed", stats);
});
