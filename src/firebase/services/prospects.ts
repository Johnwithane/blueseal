// Client service for seeded prospect listings.
//   - searchProspects / getProspect: the read surface (Phase 2). Prospects are
//     surfaced in search alongside verified tradespeople but rendered with a
//     "Pending verification" badge and no trust UI.
//   - bulkImportProspects: admin import wrapper (Phase 1).
// Outreach + claim wrappers arrive in later phases.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { distanceBetween, geohashQueryBounds } from "geofire-common";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import type { ProspectDoc, WithId } from "@/firebase/interfaces";

const prospectsCol = () =>
  collection(db, "prospects").withConverter(typedConverter<ProspectDoc>());

export interface ProspectSearchOpts {
  trade?: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  limit?: number;
}

/**
 * Geohash bounding-box search of LISTED prospects; precise distance filter
 * applied client-side. A near-copy of searchTradespeople (rating/availability
 * filters dropped — seeded listings have neither). The `isListed == true`
 * filter is mandatory: /prospects rules deny read on unlisted (suppressed)
 * docs, and Firestore aborts the whole query if any row is rule-blocked.
 */
export async function searchProspects(
  opts: ProspectSearchOpts,
): Promise<Array<WithId<ProspectDoc> & { distanceKm: number }>> {
  const center: [number, number] = [opts.centerLat, opts.centerLng];
  const radiusMeters = opts.radiusKm * 1000;
  const bounds = geohashQueryBounds(center, radiusMeters);

  const queries = bounds.map((b) =>
    query(
      prospectsCol(),
      where("isListed", "==", true),
      orderBy("geohashPublic"),
      where("geohashPublic", ">=", b[0]),
      where("geohashPublic", "<=", b[1]),
    ),
  );

  const snaps = await Promise.all(queries.map((q) => getDocs(q)));
  const seen = new Set<string>();
  const out: Array<WithId<ProspectDoc> & { distanceKm: number }> = [];

  for (const snap of snaps) {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data();
      const distKm = distanceBetween(center, [
        data.locationApprox.latitude,
        data.locationApprox.longitude,
      ]);
      if (distKm > opts.radiusKm) continue;
      if (opts.trade && !data.trades.includes(opts.trade)) continue;
      out.push({ id: d.id, ...data, distanceKm: distKm });
    }
  }

  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export async function getProspect(id: string): Promise<WithId<ProspectDoc> | null> {
  const snap = await getDoc(
    doc(db, "prospects", id).withConverter(typedConverter<ProspectDoc>()),
  );
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export interface BulkImportProspectsResult {
  received: number;
  imported: number; // for dryRun: the count that WOULD import
  dupeSkipped: number;
  suppressedSkipped: number;
  invalid: number;
  errors: Array<{ rowIndex: number; message: string }>;
  dryRun: boolean;
}

/**
 * Admin-only. Imports reviewed seeded-prospect rows. The server
 * (functions/src/seed/bulkImportProspects.ts) re-validates every row with Zod —
 * it is the source of truth — so the reviewed file rows are passed through
 * untyped here rather than duplicating the Zod shape on the client.
 *
 * Pass `dryRun: true` to preview counts (imported / dupeSkipped /
 * suppressedSkipped / invalid) without writing anything.
 */
export async function bulkImportProspects(
  rows: unknown[],
  dryRun = false,
): Promise<BulkImportProspectsResult> {
  const callable = httpsCallable<
    { rows: unknown[]; dryRun: boolean },
    BulkImportProspectsResult
  >(functions, "bulkImportProspects");
  const { data } = await callable({ rows, dryRun });
  return data;
}
