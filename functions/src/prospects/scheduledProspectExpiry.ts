import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";

/**
 * Daily scan: any held prospect lead still pending_signup past its expiresAt
 * flips to "expired". Without this, the per-client open-lead cap would be a
 * permanent ceiling (nothing else decrements pending leads except an actual
 * claim). Requires the prospectLeads (status, expiresAt) composite index.
 */
export const scheduledProspectExpiry = onSchedule(
  { schedule: "every day 03:30", timeZone: "America/Vancouver" },
  async () => {
    const now = Timestamp.now();
    const snap = await db
      .collection("prospectLeads")
      .where("status", "==", "pending_signup")
      .where("expiresAt", "<=", now)
      .limit(500)
      .get();
    if (snap.empty) {
      logger.info("scheduledProspectExpiry: nothing to expire");
      return;
    }
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.update(doc.ref, { status: "expired" });
    }
    await batch.commit();
    logger.info(`scheduledProspectExpiry: expired ${snap.size} leads`);
  },
);
