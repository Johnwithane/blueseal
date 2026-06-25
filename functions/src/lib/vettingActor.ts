import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { db } from "./admin";
import { requireRepActive } from "./salesRep";

function tokenHasRole(req: CallableRequest<unknown>, role: string): boolean {
  const token = req.auth?.token as { role?: unknown; roles?: unknown } | undefined;
  if (!token) return false;
  if (Array.isArray(token.roles) && token.roles.includes(role)) return true;
  return token.role === role;
}

export interface VettingActor {
  uid: string;
  role: "admin" | "sales";
}

/**
 * Authorize a vetting action: an admin (full authority) OR an ACTIVE, signed
 * sales rep. Reps are additionally scoped to the tradies they OWN — call
 * assertRepOwnsTradie after this when the actor is a rep. Throws otherwise.
 */
export async function requireVettingActor(req: CallableRequest<unknown>): Promise<VettingActor> {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in required.");
  if (tokenHasRole(req, "admin")) return { uid, role: "admin" };
  if (tokenHasRole(req, "sales")) {
    await requireRepActive(uid); // signed current agreement + active
    return { uid, role: "sales" };
  }
  throw new HttpsError("permission-denied", "Admin or sales rep required.");
}

/**
 * Throws unless the rep OWNS this tradesperson: they referred them
 * (tradie.referredByRepId == rep), or they own the tradie's region
 * (region.repId == rep). Referral beats region (either makes them the owner).
 */
export async function assertRepOwnsTradie(repUid: string, tradieUid: string): Promise<void> {
  const snap = await db.doc(`tradespeople/${tradieUid}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Tradesperson not found.");
  const t = snap.data() as { referredByRepId?: string | null; regionId?: string | null };
  if (t.referredByRepId && t.referredByRepId === repUid) return;
  if (t.regionId) {
    const regionSnap = await db.doc(`regions/${t.regionId}`).get();
    if (regionSnap.exists && regionSnap.get("repId") === repUid) return;
  }
  throw new HttpsError("permission-denied", "This applicant isn't in your territory.");
}
