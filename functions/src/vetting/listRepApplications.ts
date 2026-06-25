import { onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requireRepActive } from "../lib/salesRep";

/**
 * The pending applications a sales rep OWNS (referred by them, or in one of
 * their regions). Server-filtered: reps can't list pending tradesperson docs via
 * Firestore rules (they're admin/owner-only, and "rules are not filters"), so
 * this Admin-SDK call does the ownership filtering and returns only their subset.
 * Gated on an active, signed rep.
 */
export const listRepApplications = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "sales");
  await requireRepActive(uid);

  const regionsSnap = await db.collection("regions").where("repId", "==", uid).get();
  const regionIds = new Set(regionsSnap.docs.map((d) => d.id));

  const pendingSnap = await db
    .collection("tradespeople")
    .where("vettingStatus", "==", "pending")
    .orderBy("submittedAt", "asc")
    .limit(200)
    .get();

  const applications = pendingSnap.docs
    .filter((d) => {
      const t = d.data() as { regionId?: string | null; referredByRepId?: string | null };
      // Referral beats region; either makes this rep the owner.
      return t.referredByRepId === uid || (t.regionId != null && regionIds.has(t.regionId));
    })
    .map((d) => ({ id: d.id, ...d.data() }));

  return { applications };
});
