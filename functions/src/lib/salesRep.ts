import { HttpsError } from "firebase-functions/v2/https";
import type { Timestamp } from "firebase-admin/firestore";
import { db } from "./admin";

// Current sales-rep liability agreement version. KEEP IN SYNC with the client
// copy in src/sales/agreement.ts (REP_AGREEMENT_VERSION). Bump when the wording
// changes — every rep is then forced to re-sign before they can act again.
export const REP_AGREEMENT_VERSION = "2026-06-24";

export interface SalesRepLiability {
  version: string;
  signedAt: Timestamp;
  signatureStoragePath: string;
}

export interface SalesRepState {
  referralCode: string;
  active: boolean;
  liability: SalesRepLiability | null;
  createdAt: Timestamp;
}

/**
 * Throws unless the caller is an ACTIVE sales rep who has signed the CURRENT
 * liability agreement. A rep is fully inert until they sign: no referral code,
 * no vetting. Returns the salesRep state for callers that need it. Admin code
 * paths bypass this (admin can always act); this gate is for rep self-actions.
 */
export async function requireRepActive(uid: string): Promise<SalesRepState> {
  const snap = await db.doc(`users/${uid}`).get();
  const rep = (snap.exists ? snap.data()?.salesRep : null) as SalesRepState | null;
  if (!rep || rep.active === false) {
    throw new HttpsError("failed-precondition", "Your sales rep account is not active.");
  }
  if (!rep.liability || rep.liability.version !== REP_AGREEMENT_VERSION) {
    throw new HttpsError(
      "failed-precondition",
      "Please sign the current sales representative agreement first.",
    );
  }
  return rep;
}
