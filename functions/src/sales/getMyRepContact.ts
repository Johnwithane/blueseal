// Tradesperson-only: who is my Blue Seal rep? Resolves the calling
// tradesperson's owning rep (the same rule the commission engine uses: the rep
// whose code they used, else their region's rep, while active) and returns that
// rep's name + contact email so the tradie can reach their point of contact.
// Returns hasRep:false when nobody owns them (a direct, unregioned signup).

import { onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { resolveCommissionOwner } from "../lib/commissionOwner";

export const getMyRepContact = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const owner = await resolveCommissionOwner(uid);
  if (!owner) return { hasRep: false as const };

  const snap = await db.doc(`users/${owner.repId}`).get();
  const data = snap.data();
  if (!data) return { hasRep: false as const };

  return {
    hasRep: true as const,
    name: (data.displayName as string) || "Your Blue Seal rep",
    email: (data.email as string) || null,
    ownerKind: owner.ownerKind, // "referral" | "region"
  };
});
