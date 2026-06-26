import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { db } from "./admin";

// Current project-manager agreement version. KEEP IN SYNC with the client copy
// in src/projectManager/agreement.ts (PM_AGREEMENT_VERSION). Bump when the
// wording changes — a PM is then forced to re-sign before their next payout.
export const PM_AGREEMENT_VERSION = "2026-06-25";

export interface ProjectManagerLiability {
  version: string;
  signedAt: Timestamp;
  signatureStoragePath: string;
}

export interface ProjectManagerState {
  referralCode: string;
  active: boolean;
  liability: ProjectManagerLiability | null;
  createdAt: Timestamp;
}

/**
 * The `projectManager` sub-object stamped on users/{uid} the moment the PM role
 * is enabled (at signup, or via addRoleToSelf for an existing client). Unlike a
 * sales rep, a PM is ACTIVE immediately — there is no admin approval and no
 * vetting, and the public profile goes live right away. The liability agreement
 * is signed later, at payout setup (it gates commission payout, not the cockpit).
 */
export function initialProjectManagerState() {
  return {
    referralCode: "",
    active: true,
    liability: null,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Throws unless the caller is an ACTIVE project manager. Does NOT require a
 * signed agreement (that gate lives at payout setup — see assertPmAgreementSigned).
 * Use for cockpit + recruiting-code actions. Admin code paths bypass this.
 */
export async function requirePmActive(uid: string): Promise<ProjectManagerState> {
  const snap = await db.doc(`users/${uid}`).get();
  const pm = (snap.exists ? snap.data()?.projectManager : null) as ProjectManagerState | null;
  if (!pm || pm.active === false) {
    throw new HttpsError("failed-precondition", "Your project manager account is not active.");
  }
  return pm;
}

/**
 * Throws unless the PM has signed the CURRENT agreement version. Gates payout
 * onboarding + transfers (money), not the cockpit.
 */
export function assertPmAgreementSigned(pm: ProjectManagerState): void {
  if (!pm.liability || pm.liability.version !== PM_AGREEMENT_VERSION) {
    throw new HttpsError(
      "failed-precondition",
      "Please sign the current project manager agreement first.",
    );
  }
}

/**
 * Resolve a PM recruiting code to the project manager who owns it — only if that
 * PM is ACTIVE. Mirrors resolveReferralRepId; case-insensitive (the registry is
 * keyed by the lowercased code). The agreement is NOT required to recruit (it
 * gates payout, not the cockpit). Returns the PM uid, or null if unknown/inactive.
 */
export async function resolvePmId(code: string): Promise<string | null> {
  const codeLower = code.trim().toLowerCase();
  if (!codeLower) return null;
  const codeSnap = await db.doc(`pmReferralCodes/${codeLower}`).get();
  if (!codeSnap.exists) return null;
  const pmId = codeSnap.get("uid") as string | undefined;
  if (!pmId) return null;
  const pmSnap = await db.doc(`users/${pmId}`).get();
  const pm = pmSnap.data()?.projectManager as { active?: boolean } | undefined;
  if (!pm || pm.active === false) return null;
  return pmId;
}
