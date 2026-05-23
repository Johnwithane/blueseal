/**
 * Maps a certification's issuing body to the right provincial/national
 * registry that admins can use to verify the cert during vetting.
 *
 * There's no single Canada-wide registry — each province runs its own.
 * Direct links exist for jurisdictions with public lookup tools (AB, BC, ON
 * compulsory). Red Seal endorsements are issued provincially, so for those
 * we point at the Red Seal hub that links out to each provincial registry.
 */

export interface CertRegistry {
  province: string;
  registryName: string;
  url: string;
  notes?: string;
}

export const RED_SEAL_HUB: CertRegistry = {
  province: "Canada (provincial)",
  registryName: "Red Seal — credential verification hub",
  url: "https://red-seal.ca/eng/credential/credential.shtml",
  notes:
    "Red Seal endorsements are issued by the province. Pick the issuing province from this page to reach its registry.",
};

const DIRECT_REGISTRIES: Record<string, CertRegistry> = {
  "Skilled Trades Ontario": {
    province: "Ontario",
    registryName: "Skilled Trades Ontario — Public Register",
    url: "https://www.skilledtradesontario.ca/public-register/",
    notes:
      "Compulsory trades only. Non-compulsory: email verification@skilledtradesontario.ca with name + cert # (~10 business days).",
  },
  SkilledTradesBC: {
    province: "British Columbia",
    registryName: "SkilledTradesBC — Verify a Tradesperson",
    url: "https://skilledtradesbc.ca/forms-registration/verify-tradespersons-certification",
  },
  "Alberta Apprenticeship & Industry Training": {
    province: "Alberta",
    registryName: "Alberta Tradesperson Lookup",
    url: "https://tradesecrets.alberta.ca/",
    notes: "Use the Tradesperson Lookup tool. Search by name + certificate number.",
  },
};

export function registryForIssuingBody(issuingBody: string | null | undefined): CertRegistry | null {
  if (!issuingBody) return null;
  const direct = DIRECT_REGISTRIES[issuingBody];
  if (direct) return direct;
  if (/red seal/i.test(issuingBody)) return RED_SEAL_HUB;
  return null;
}
