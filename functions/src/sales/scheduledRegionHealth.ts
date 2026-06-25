// Daily per-region health recount. For each region: how many of its
// tradespeople are LIVE (isVisible + vetting approved) vs total, written back to
// regions/{id}.activeTradieCount / totalTradieCount. The first day a region's
// active count reaches its marketing threshold, stamp marketing.unlockedAt — the
// signal an admin can allocate a regional marketing budget (surfaced in the
// admin regions console).
//
// Counts in memory over `where regionId == X` (single-field auto-index) instead
// of an aggregate count() with three equality filters, which would need a
// (regionId, isVisible, vettingStatus) composite index. Region member counts are
// modest, and .select() keeps the payload to two fields per doc.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";

export const scheduledRegionHealth = onSchedule(
  { schedule: "every day 02:00", timeZone: "America/Vancouver" },
  async () => {
    const regions = await db.collection("regions").get();
    let unlocked = 0;

    for (const regionSnap of regions.docs) {
      const region = regionSnap.data() as {
        marketing?: { thresholdActive?: number; unlockedAt?: unknown };
      };
      const members = await db
        .collection("tradespeople")
        .where("regionId", "==", regionSnap.id)
        .select("isVisible", "vettingStatus")
        .get();

      let active = 0;
      for (const m of members.docs) {
        const d = m.data();
        if (d.isVisible === true && d.vettingStatus === "approved") active += 1;
      }
      const total = members.size;

      const threshold = region.marketing?.thresholdActive ?? 0;
      const alreadyUnlocked = region.marketing?.unlockedAt != null;
      const justUnlocked = !alreadyUnlocked && threshold > 0 && active >= threshold;

      await regionSnap.ref.set(
        {
          activeTradieCount: active,
          totalTradieCount: total,
          // Deep-merge: only stamp unlockedAt the first time the threshold is hit;
          // an empty marketing map leaves threshold/allocated/notes/prior unlock intact.
          marketing: justUnlocked ? { unlockedAt: FieldValue.serverTimestamp() } : {},
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      if (justUnlocked) {
        unlocked += 1;
        logger.info("regionHealth: marketing budget unlocked", {
          regionId: regionSnap.id,
          active,
          threshold,
        });
      }
    }

    logger.info("regionHealth recomputed", { regions: regions.size, unlocked });
  },
);
