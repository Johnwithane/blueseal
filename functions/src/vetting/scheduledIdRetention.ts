import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { db, storage } from "../lib/admin";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Daily sweep: for any tradie approved more than 90 days ago whose ID file
 * is still in Storage, delete it and mark the doc clean. Per design.md
 * § 4.1 — compliance hygiene for ID documents.
 */
export const scheduledIdRetention = onSchedule("every day 03:00", async () => {
  const cutoff = Date.now() - NINETY_DAYS_MS;
  const tradies = await db
    .collection("tradespeople")
    .where("isVisible", "==", true)
    .where("idVerified", "==", true)
    .get();

  let deleted = 0;
  for (const doc of tradies.docs) {
    const approvedAtTs = (doc.data().approvedAt as FirebaseFirestore.Timestamp | undefined);
    if (!approvedAtTs) continue;
    if (approvedAtTs.toMillis() > cutoff) continue;
    const idRef = db.doc(`idVerifications/${doc.id}`);
    const idSnap = await idRef.get();
    if (!idSnap.exists) continue;
    const fileUrl = (idSnap.data() as { fileUrl?: string }).fileUrl;
    if (!fileUrl) continue;
    // Best-effort delete; extract the path from Storage URL or skip.
    try {
      const path = fileUrl.split("/o/")[1]?.split("?")[0];
      if (path) await storage.bucket().file(decodeURIComponent(path)).delete();
      await idRef.update({ fileUrl: "", documentType: "drivers_license" });
      deleted++;
    } catch (e) {
      logger.warn("ID delete failed", { uid: doc.id, error: (e as Error).message });
    }
  }
  logger.info("ID retention sweep complete", { deleted });
});
