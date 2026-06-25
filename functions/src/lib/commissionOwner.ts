// Resolve who owns a tradesperson's Blue Seal revenue for commission purposes.
// This is the "unified ownership rule" (design.md / SALES_REPS_BUILD.md): the
// referring rep (frozen at signup on tradespeople/{uid}.referredByRepId) wins,
// ELSE the rep who owns the tradesperson's region, ELSE nobody (platform keeps
// 100%). A deactivated referral rep falls back to the region rep.

import { db } from "./admin";
import type { CommissionOwnerKind } from "./commissionTypes";

export interface CommissionOwner {
  repId: string;
  /** Region the tradesperson belongs to (carried through even for a referral owner). */
  regionId: string | null;
  ownerKind: CommissionOwnerKind;
}

/**
 * The owning rep for a tradesperson, or null when nobody owns them.
 *
 * Referral beats region, but only while the referring rep is ACTIVE — a
 * deactivated referral rep falls through to the region's current rep (matching
 * the rule "the rep whose code they used, ELSE their region's rep"). Region
 * ownership is taken straight from regions/{id}.repId; admin unassigns a region
 * when its rep leaves, so there's no separate active check there.
 */
export async function resolveCommissionOwner(
  tradespersonId: string,
): Promise<CommissionOwner | null> {
  const snap = await db.doc(`tradespeople/${tradespersonId}`).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const referredByRepId =
    (data.referredByRepId as string | null | undefined) ?? null;
  const regionId = (data.regionId as string | null | undefined) ?? null;

  // 1) Referral ownership — frozen at signup, honoured while the rep is active.
  if (referredByRepId) {
    const repSnap = await db.doc(`users/${referredByRepId}`).get();
    const rep = repSnap.data()?.salesRep as { active?: boolean } | undefined;
    if (rep?.active !== false) {
      return { repId: referredByRepId, regionId, ownerKind: "referral" };
    }
  }

  // 2) Region ownership — the territory's current rep.
  if (regionId) {
    const regionSnap = await db.doc(`regions/${regionId}`).get();
    const repId = (regionSnap.data()?.repId as string | null | undefined) ?? null;
    if (repId) {
      return { repId, regionId, ownerKind: "region" };
    }
  }

  // 3) Unowned — no commission accrues; the platform keeps 100%.
  return null;
}
