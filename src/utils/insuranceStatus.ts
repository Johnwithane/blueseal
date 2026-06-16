import type { Timestamp } from "firebase/firestore";

/**
 * Minimal shape needed to judge a tradesperson's liability-insurance status.
 * Matches the PUBLIC, server-managed mirror on `tradespeople/{uid}` — the only
 * insurance fields a client (or the public profile) can read. The private
 * `insuranceVerifications/{uid}` doc is owner+admin only and is NOT used here.
 */
export interface InsuranceStatusFields {
  insuranceVerified?: boolean | null;
  insuranceExpiresAt?: Timestamp | Date | null;
}

function toMillis(v: Timestamp | Date | null | undefined): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  // Firestore Timestamp — guarded so a malformed value reads as "unknown".
  if (typeof (v as Timestamp).toMillis === "function") return (v as Timestamp).toMillis();
  return null;
}

/**
 * Liability-insurance gate — the single source of truth across the whole app
 * for "is this tradesperson currently insured?".
 *
 * Insured ⇔ an admin has VERIFIED their liability policy (`insuranceVerified`)
 * AND the recorded expiry is still in the future. The badge stays up "until the
 * recorded expiry date passes" (ToS § 4.1), so `insuranceVerified` can be true
 * with a past expiry — both conditions must hold.
 *
 * WSIB / workers'-comp is intentionally OUT of scope: it has legitimate
 * exemptions (e.g. sole proprietors with no employees), so flagging it here
 * would raise false "uninsured" alarms. Liability only.
 *
 * Fails CLOSED: a missing or unparseable expiry → treated as NOT insured, so
 * the uninsured-waiver path is the safe default.
 */
export function isTradieInsured(
  t: InsuranceStatusFields | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!t || t.insuranceVerified !== true) return false;
  const expires = toMillis(t.insuranceExpiresAt);
  return expires != null && expires > now;
}
