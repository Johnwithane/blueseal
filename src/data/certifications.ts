/**
 * Canadian trade certification presets.
 *
 * Each trade has a list of common certifications (Red Seal endorsements,
 * provincial trade certificates, gas/electrical licences, etc.) and a list of
 * common issuing bodies. These power dropdowns in the onboarding wizard so a
 * tradesperson doesn't have to type from scratch.
 *
 * Lists are not exhaustive — every trade includes an "Other" option that
 * falls back to free text.
 */

export interface CertPreset {
  label: string;
  /** Short, displayable name of the credential, e.g. "Red Seal — Plumber (306A)". */
  name: string;
  /** Likely issuing body — pre-fills the issuing-body select if chosen. */
  defaultIssuer?: string;
}

export const OTHER_CERT: CertPreset = {
  label: "Other / custom credential",
  name: "",
};

/**
 * Canada-wide trade-licence presets keyed by the trade `key` in `data/trades.ts`.
 * Red Seal is the interprovincial standard; provincial bodies are listed for
 * trades where a province issues the actual licence.
 */
export const CERT_PRESETS_BY_TRADE: Record<string, CertPreset[]> = {
  plumber: [
    { label: "Red Seal — Plumber (306A)", name: "Red Seal — Plumber (306A)", defaultIssuer: "Red Seal Program" },
    { label: "Provincial Plumber Certificate of Qualification", name: "Plumber — Certificate of Qualification" },
    { label: "Gas Technician 2 (G2)", name: "Gas Technician 2 (G2)", defaultIssuer: "TSSA (Ontario)" },
    { label: "Gas Technician 3 (G3)", name: "Gas Technician 3 (G3)", defaultIssuer: "TSSA (Ontario)" },
  ],
  electrician: [
    { label: "Red Seal — Construction Electrician (309A)", name: "Red Seal — Construction Electrician (309A)", defaultIssuer: "Red Seal Program" },
    { label: "Red Seal — Industrial Electrician (442A)", name: "Red Seal — Industrial Electrician (442A)", defaultIssuer: "Red Seal Program" },
    { label: "Master Electrician licence", name: "Master Electrician licence", defaultIssuer: "ESA (Ontario)" },
    { label: "Electrical Contractor licence (ECRA/ESA)", name: "Electrical Contractor licence (ECRA/ESA)", defaultIssuer: "ESA (Ontario)" },
    { label: "FSR — Field Safety Representative (BC)", name: "FSR — Field Safety Representative", defaultIssuer: "Technical Safety BC" },
  ],
  hvac: [
    { label: "Red Seal — Refrigeration & A/C Mechanic (313A)", name: "Red Seal — Refrigeration & A/C Mechanic (313A)", defaultIssuer: "Red Seal Program" },
    { label: "Gas Technician 2 (G2)", name: "Gas Technician 2 (G2)", defaultIssuer: "TSSA (Ontario)" },
    { label: "Gas Technician 3 (G3)", name: "Gas Technician 3 (G3)", defaultIssuer: "TSSA (Ontario)" },
    { label: "ODP Card (Ozone Depletion Prevention)", name: "ODP Card — Ozone Depletion Prevention", defaultIssuer: "HRAI" },
  ],
  carpenter: [
    { label: "Red Seal — General Carpenter", name: "Red Seal — General Carpenter", defaultIssuer: "Red Seal Program" },
    { label: "Provincial Carpenter Certificate of Qualification", name: "Carpenter — Certificate of Qualification" },
  ],
  painter: [
    { label: "Red Seal — Painter & Decorator", name: "Red Seal — Painter & Decorator", defaultIssuer: "Red Seal Program" },
  ],
  roofer: [
    { label: "Red Seal — Roofer", name: "Red Seal — Roofer", defaultIssuer: "Red Seal Program" },
    { label: "Working at Heights training", name: "Working at Heights training", defaultIssuer: "MLITSD-approved provider (Ontario)" },
  ],
  landscaper: [
    { label: "Red Seal — Landscape Horticulturist", name: "Red Seal — Landscape Horticulturist", defaultIssuer: "Red Seal Program" },
    { label: "Certified Horticultural Technician (CNLA)", name: "Certified Horticultural Technician (CHT)", defaultIssuer: "Canadian Nursery Landscape Association" },
  ],
  handyman: [
    { label: "WSIB / WorkSafe clearance certificate", name: "WSIB clearance certificate", defaultIssuer: "WSIB / provincial workers' comp" },
    { label: "Business licence", name: "Business licence (municipal)" },
  ],
  appliance_repair: [
    { label: "Red Seal — Appliance Service Technician", name: "Red Seal — Appliance Service Technician", defaultIssuer: "Red Seal Program" },
    { label: "Gas Technician 2 (G2)", name: "Gas Technician 2 (G2)", defaultIssuer: "TSSA (Ontario)" },
  ],
  drywall: [
    { label: "Red Seal — Drywall Finisher & Plasterer", name: "Red Seal — Drywall Finisher & Plasterer", defaultIssuer: "Red Seal Program" },
  ],
  flooring: [
    { label: "Red Seal — Floorcovering Installer", name: "Red Seal — Floorcovering Installer", defaultIssuer: "Red Seal Program" },
  ],
  tiling: [
    { label: "Red Seal — Tilesetter", name: "Red Seal — Tilesetter", defaultIssuer: "Red Seal Program" },
  ],
  locksmith: [
    { label: "Provincial locksmith / security worker licence", name: "Locksmith / security worker licence" },
  ],
  pest_control: [
    { label: "Provincial pesticide applicator licence", name: "Pesticide applicator licence" },
    { label: "Structural Exterminator licence (Ontario)", name: "Structural Exterminator licence", defaultIssuer: "Ontario Ministry of the Environment" },
  ],
  cleaning: [
    { label: "WHMIS 2015 training", name: "WHMIS 2015 training" },
    { label: "Bonded & insured (general liability)", name: "Bonded & insured — general liability" },
  ],
};

/** Common Canadian issuing bodies, used as suggestions in the issuing-body select. */
export const ISSUING_BODIES: string[] = [
  "Red Seal Program",
  "Skilled Trades Ontario",
  "ESA (Ontario)",
  "TSSA (Ontario)",
  "SkilledTradesBC",
  "Technical Safety BC",
  "Alberta Apprenticeship & Industry Training",
  "SaskApprenticeship",
  "Apprenticeship Manitoba",
  "CCQ (Québec)",
  "Apprenticeship & Certification — Nova Scotia",
  "WorkplaceNB — Apprenticeship (New Brunswick)",
  "Newfoundland & Labrador — Apprenticeship & Trades Certification",
  "PEI Apprenticeship",
  "Yukon Apprenticeship",
  "HRAI",
  "Canadian Nursery Landscape Association",
];

export function presetsForTrade(tradeKey: string): CertPreset[] {
  return CERT_PRESETS_BY_TRADE[tradeKey] ?? [];
}
