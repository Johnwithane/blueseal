import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db, storage } from "../lib/admin";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Daily sweep: for any tradie approved more than 90 days ago whose ID file
 * is still in Storage, delete it and mark the doc clean. Per design.md
 * § 4.1 — compliance hygiene for ID documents.
 *
 * Hardened: parsed Storage path must live under `tradespeople/{uid}/id/`,
 * otherwise we refuse to delete. Prevents an attacker who can write any
 * `fileUrl` from coercing the retention sweep into a privileged delete on
 * an arbitrary Storage object.
 */
export const scheduledIdRetention = onSchedule(
  { schedule: "every day 03:00", timeZone: "America/Toronto" },
  async () => {
    const cutoff = Date.now() - NINETY_DAYS_MS;
    const tradies = await db
      .collection("tradespeople")
      .where("isVisible", "==", true)
      .where("idVerified", "==", true)
      .limit(500)
      .get();

    let deleted = 0;
    for (const doc of tradies.docs) {
      const approvedAtTs = doc.data().approvedAt as FirebaseFirestore.Timestamp | undefined;
      if (!approvedAtTs) continue;
      if (approvedAtTs.toMillis() > cutoff) continue;
      const idRef = db.doc(`idVerifications/${doc.id}`);
      const idSnap = await idRef.get();
      if (!idSnap.exists) continue;
      const fileUrl = (idSnap.data() as { fileUrl?: string }).fileUrl;
      if (!fileUrl) continue;
      try {
        const raw = fileUrl.split("/o/")[1]?.split("?")[0];
        if (!raw) continue;
        const path = decodeURIComponent(raw);
        const expectedPrefix = `tradespeople/${doc.id}/id/`;
        if (!path.startsWith(expectedPrefix)) {
          logger.warn("Refusing to delete ID path outside expected prefix", {
            uid: doc.id,
            path,
          });
          continue;
        }
        await storage.bucket().file(path).delete();
        await idRef.update({ fileUrl: "", deletedAt: FieldValue.serverTimestamp() });
        deleted++;
      } catch (e) {
        logger.warn("ID delete failed", { uid: doc.id, error: (e as Error).message });
      }
    }
    logger.info("ID retention sweep complete", { deleted });
  },
);
