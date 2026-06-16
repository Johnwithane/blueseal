import { Timestamp } from "firebase-admin/firestore";

/**
 * Version of the uninsured-work disclosure + waiver copy. Stamped onto every
 * recorded acknowledgment (insuranceWaivers/{jobId} and the job's request-time
 * ack) so a later dispute can tie a signature to the exact wording the party
 * saw. Bump this whenever the client disclosure or the tradesperson waiver text
 * changes materially. MUST stay in sync with the client mirror in
 * src/data/insuranceWaiver.ts.
 */
export const UNINSURED_DISCLOSURE_VERSION = "1.0";

/**
 * Version of the liability-release copy a tradesperson signs when they upload
 * their OWN policy that does NOT name Blue Seal as an additional insured.
 * Stamped onto insuranceVerifications/{uid}.liabilityRelease. MUST stay in sync
 * with src/data/insuranceWaiver.ts (INSURANCE_RELEASE_VERSION). Bump on any
 * material wording change.
 */
export const INSURANCE_RELEASE_VERSION = "1.0";

/**
 * PUBLIC liability-insurance mirror fields, as carried on tradespeople/{uid}.
 * Set by the onInsuranceApproved trigger; never written by the owner.
 */
export interface InsuranceStatusFields {
  insuranceVerified?: boolean | null;
  insuranceExpiresAt?: Timestamp | null;
}

/**
 * Server-side liability-insurance gate — the authoritative check the callables
 * use to decide whether an uninsured-work acknowledgment is required. Mirrors
 * src/utils/insuranceStatus.ts exactly: insured ⇔ verified AND not yet expired.
 *
 * The client check is a hint; THIS is the real boundary. WSIB is out of scope
 * (liability only). Fails CLOSED on a missing/unparseable expiry.
 */
export function isTradieInsured(
  t: InsuranceStatusFields | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!t || t.insuranceVerified !== true) return false;
  const exp = t.insuranceExpiresAt;
  const ms = exp && typeof exp.toMillis === "function" ? exp.toMillis() : null;
  return ms != null && ms > nowMs;
}
