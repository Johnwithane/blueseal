import { db } from "./admin";

/**
 * Resolve a referral code to the rep who owns it — but ONLY if that rep is an
 * ACTIVE rep who has signed the agreement. An unsigned or deactivated rep's
 * code does nothing (no attribution, no free month), matching the rule that a
 * rep is inert until they sign. Case-insensitive (the registry is keyed by the
 * lowercased code). Returns the rep's uid, or null if unknown/inactive.
 */
export async function resolveReferralRepId(code: string): Promise<string | null> {
  const codeLower = code.trim().toLowerCase();
  if (!codeLower) return null;
  const codeSnap = await db.doc(`referralCodes/${codeLower}`).get();
  if (!codeSnap.exists) return null;
  const repId = codeSnap.get("uid") as string | undefined;
  if (!repId) return null;
  const repSnap = await db.doc(`users/${repId}`).get();
  const rep = repSnap.data()?.salesRep as { active?: boolean; liability?: unknown } | undefined;
  // active !== false (default-active) AND has signed some agreement version.
  if (!rep || rep.active === false || rep.liability == null) return null;
  return repId;
}
