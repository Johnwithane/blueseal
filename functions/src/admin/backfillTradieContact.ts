// One-shot admin callable: migrate every tradesperson doc to the F1
// public/private split. The exact location + (home) address + billing contact
// move OFF the world-readable public doc into tradespeople/{uid}/private/
// contact, and the public doc gets the coarse search fields (locationApprox +
// geohashPublic) instead.
//
// WHY THIS IS REQUIRED, not optional. Until it runs, for every pre-existing
// tradesperson:
//   1. The exact home coordinates + street address are STILL world-readable on
//      the public doc — the F1 leak stays open.
//   2. Discovery returns ZERO results for them: searchTradespeople +
//      onJobPostCreated now query `geohashPublic`, which legacy docs don't have.
//   3. The profile/onboarding editors read the contact subdoc, which is empty,
//      so the tradie's saved address/pin appears blank.
// Copying into the subdoc, deriving the public coarse fields, and deleting the
// six legacy fields off the public doc fixes all three.
//
// Idempotent: a doc with no legacy `geohash` AND no legacy `location` is
// skipped, so re-running after a partial run is safe. Resumable cursor.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, GeoPoint } from "firebase-admin/firestore";
import { geohashForLocation } from "geofire-common";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

const PAGE_SIZE = 200;

// ~2 decimals ≈ 1.1 km. Matches the client-side toApprox() in tradespeople.ts.
const toApprox = (n: number): number => Math.round(n * 100) / 100;

interface BackfillResult {
  scanned: number;
  migrated: number;
  skipped: number; // already migrated / nothing to do
  pages: number;
}

export const backfillTradieContact = onCall(
  { enforceAppCheck: false },
  async (req): Promise<BackfillResult> => {
    const actor = requireAdmin(req);

    let scanned = 0;
    let migrated = 0;
    let skipped = 0;
    let pages = 0;
    let lastDocId: string | null = null;

    while (true) {
      let query = db.collection("tradespeople").limit(PAGE_SIZE);
      if (lastDocId) {
        const cursor = await db.doc(`tradespeople/${lastDocId}`).get();
        query = query.startAfter(cursor);
      }
      const snap = await query.get();
      if (snap.empty) break;
      pages += 1;
      scanned += snap.size;

      for (const tradieSnap of snap.docs) {
        const legacyGeohash = tradieSnap.get("geohash");
        const legacyLocation = tradieSnap.get("location") as GeoPoint | null | undefined;
        const legacyAddress = tradieSnap.get("primaryAddressText");

        // Nothing legacy present → already migrated (or never had a location).
        if (legacyGeohash === undefined && legacyLocation == null && legacyAddress === undefined) {
          skipped += 1;
          continue;
        }

        // Build the private contact subdoc from whatever the public doc held.
        const contact: Record<string, unknown> = {
          primaryAddressText:
            typeof legacyAddress === "string" ? legacyAddress : "",
          businessAddress: tradieSnap.get("businessAddress") ?? null,
          businessPhone: tradieSnap.get("businessPhone") ?? null,
          gstNumber: tradieSnap.get("gstNumber") ?? null,
        };

        // Derive the public coarse fields. Prefer the exact location; if a doc
        // somehow only had a geohash, fall back to truncating it.
        const publicPatch: Record<string, unknown> = {
          geohash: FieldValue.delete(),
          location: FieldValue.delete(),
          primaryAddressText: FieldValue.delete(),
          businessAddress: FieldValue.delete(),
          businessPhone: FieldValue.delete(),
          gstNumber: FieldValue.delete(),
        };

        if (legacyLocation && typeof legacyLocation.latitude === "number") {
          const { latitude: lat, longitude: lng } = legacyLocation;
          contact.location = new GeoPoint(lat, lng);
          publicPatch.locationApprox = new GeoPoint(toApprox(lat), toApprox(lng));
          publicPatch.geohashPublic =
            (lat === 0 && lng === 0 ? "" : geohashForLocation([lat, lng]).slice(0, 6));
        } else if (typeof legacyGeohash === "string" && legacyGeohash) {
          publicPatch.geohashPublic = legacyGeohash.slice(0, 6);
        } else {
          publicPatch.geohashPublic = "";
        }

        await tradieSnap.ref
          .collection("private")
          .doc("contact")
          .set(contact, { merge: true });
        await tradieSnap.ref.update(publicPatch);
        migrated += 1;
      }

      lastDocId = snap.docs[snap.docs.length - 1].id;
      if (snap.size < PAGE_SIZE) break;
    }

    await logAdminAction({
      actorUid: actor,
      action: "backfillTradieContact",
      targetType: "tradespeople",
      targetId: "*",
      metadata: { scanned, migrated, skipped, pages },
    });

    logger.info("backfillTradieContact: done", { scanned, migrated, skipped, pages, actor });

    if (scanned === 0) {
      throw new HttpsError("not-found", "No tradespeople found. Backfill had nothing to do.");
    }

    return { scanned, migrated, skipped, pages };
  },
);
