// Helpers for reading a tradesperson's PUBLIC verified credentials
// (TradespersonDoc.verifiedCredentials — see interfaces.ts). The badge UI uses
// these to decide whether to show the Red Seal badge and which trades it covers.
import type { TradespersonDoc } from "@/firebase/interfaces";

type CredentialSource = Pick<TradespersonDoc, "verifiedCredentials"> | null | undefined;

/**
 * Whether an issuing body is the Red Seal Program. Mirrors the same check in
 * functions/src/vetting/onCertApproved.ts. The seed presets always set
 * "Red Seal Program", but admins can type a free issuer, so we match any
 * casing/spacing of "red seal".
 */
export function isRedSealIssuer(issuingBody: string | null | undefined): boolean {
  return /red\s*seal/i.test(issuingBody ?? "");
}

/** True when the tradesperson holds at least one verified Red Seal credential. */
export function hasRedSeal(tradie: CredentialSource): boolean {
  return (tradie?.verifiedCredentials ?? []).some(
    (c) => c.redSeal || isRedSealIssuer(c.issuingBody),
  );
}

/** Distinct trade keys the tradesperson holds a Red Seal in (primary order). */
export function redSealTrades(tradie: CredentialSource): string[] {
  const trades = (tradie?.verifiedCredentials ?? [])
    .filter((c) => c.redSeal || isRedSealIssuer(c.issuingBody))
    .map((c) => c.trade);
  return [...new Set(trades)];
}
