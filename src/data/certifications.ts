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
  general_contractor: [
    { label: "Licensed Residential Builder (BC Housing)", name: "Residential Builder Licence", defaultIssuer: "BC Housing — Licensing & Consumer Services" },
    { label: "Provincial home builder / new-home warranty licence", name: "Home builder licence" },
    { label: "Business licence", name: "Business licence (municipal)" },
  ],

  // ── Automotive & vehicle (Red Seal) ───────────────────────────────────────
  auto_service: [
    { label: "Red Seal — Automotive Service Technician", name: "Red Seal — Automotive Service Technician", defaultIssuer: "Red Seal Program" },
    { label: "Provincial Automotive Service Technician CofQ", name: "Automotive Service Technician — Certificate of Qualification" },
  ],
  auto_body: [
    { label: "Red Seal — Auto Body and Collision Technician", name: "Red Seal — Auto Body and Collision Technician", defaultIssuer: "Red Seal Program" },
  ],
  auto_refinishing: [
    { label: "Red Seal — Automotive Refinishing Technician", name: "Red Seal — Automotive Refinishing Technician", defaultIssuer: "Red Seal Program" },
  ],
  truck_transport_mechanic: [
    { label: "Red Seal — Truck and Transport Mechanic", name: "Red Seal — Truck and Transport Mechanic", defaultIssuer: "Red Seal Program" },
  ],
  transport_trailer_tech: [
    { label: "Red Seal — Transport Trailer Technician", name: "Red Seal — Transport Trailer Technician", defaultIssuer: "Red Seal Program" },
  ],
  heavy_duty_mechanic: [
    { label: "Red Seal — Heavy Duty Equipment Technician", name: "Red Seal — Heavy Duty Equipment Technician", defaultIssuer: "Red Seal Program" },
  ],
  ag_equipment_tech: [
    { label: "Red Seal — Agricultural Equipment Technician", name: "Red Seal — Agricultural Equipment Technician", defaultIssuer: "Red Seal Program" },
  ],
  motorcycle_tech: [
    { label: "Red Seal — Motorcycle Technician", name: "Red Seal — Motorcycle Technician", defaultIssuer: "Red Seal Program" },
  ],
  rv_tech: [
    { label: "Red Seal — Recreation Vehicle Service Technician", name: "Red Seal — Recreation Vehicle Service Technician", defaultIssuer: "Red Seal Program" },
  ],

  // ── Industrial, metal & machining (Red Seal) ──────────────────────────────
  millwright: [
    { label: "Red Seal — Industrial Mechanic (Millwright)", name: "Red Seal — Industrial Mechanic (Millwright)", defaultIssuer: "Red Seal Program" },
  ],
  machinist: [
    { label: "Red Seal — Machinist", name: "Red Seal — Machinist", defaultIssuer: "Red Seal Program" },
  ],
  tool_and_die: [
    { label: "Red Seal — Tool and Die Maker", name: "Red Seal — Tool and Die Maker", defaultIssuer: "Red Seal Program" },
  ],
  metal_fabricator: [
    { label: "Red Seal — Metal Fabricator (Fitter)", name: "Red Seal — Metal Fabricator (Fitter)", defaultIssuer: "Red Seal Program" },
  ],
  sheet_metal: [
    { label: "Red Seal — Sheet Metal Worker", name: "Red Seal — Sheet Metal Worker", defaultIssuer: "Red Seal Program" },
  ],
  boilermaker: [
    { label: "Red Seal — Boilermaker", name: "Red Seal — Boilermaker", defaultIssuer: "Red Seal Program" },
  ],
  ironworker: [
    { label: "Red Seal — Ironworker (Generalist)", name: "Red Seal — Ironworker (Generalist)", defaultIssuer: "Red Seal Program" },
    { label: "Red Seal — Ironworker (Reinforcing)", name: "Red Seal — Ironworker (Reinforcing)", defaultIssuer: "Red Seal Program" },
    { label: "Red Seal — Ironworker (Structural/Ornamental)", name: "Red Seal — Ironworker (Structural/Ornamental)", defaultIssuer: "Red Seal Program" },
  ],
  instrumentation_tech: [
    { label: "Red Seal — Instrumentation and Control Technician", name: "Red Seal — Instrumentation and Control Technician", defaultIssuer: "Red Seal Program" },
  ],
  parts_technician: [
    { label: "Red Seal — Parts Technician", name: "Red Seal — Parts Technician", defaultIssuer: "Red Seal Program" },
  ],

  // ── Industrial mechanical, electrical & process (Red Seal) ────────────────
  industrial_electrician: [
    { label: "Red Seal — Industrial Electrician (442A)", name: "Red Seal — Industrial Electrician (442A)", defaultIssuer: "Red Seal Program" },
    { label: "FSR — Field Safety Representative (BC)", name: "FSR — Field Safety Representative", defaultIssuer: "Technical Safety BC" },
  ],
  powerline_tech: [
    { label: "Red Seal — Powerline Technician", name: "Red Seal — Powerline Technician", defaultIssuer: "Red Seal Program" },
  ],
  steamfitter: [
    { label: "Red Seal — Steamfitter/Pipefitter", name: "Red Seal — Steamfitter/Pipefitter", defaultIssuer: "Red Seal Program" },
  ],
  sprinkler_fitter: [
    { label: "Red Seal — Sprinkler Fitter", name: "Red Seal — Sprinkler Fitter", defaultIssuer: "Red Seal Program" },
  ],
  oil_heat_tech: [
    { label: "Red Seal — Oil Heat System Technician", name: "Red Seal — Oil Heat System Technician", defaultIssuer: "Red Seal Program" },
  ],

  // ── Construction & site operations (Red Seal) ─────────────────────────────
  heavy_equipment_operator: [
    { label: "Red Seal — Heavy Equipment Operator (Excavator)", name: "Red Seal — Heavy Equipment Operator (Excavator)", defaultIssuer: "Red Seal Program" },
    { label: "Red Seal — Heavy Equipment Operator (Dozer)", name: "Red Seal — Heavy Equipment Operator (Dozer)", defaultIssuer: "Red Seal Program" },
    { label: "Red Seal — Heavy Equipment Operator (Tractor-Loader-Backhoe)", name: "Red Seal — Heavy Equipment Operator (Tractor-Loader-Backhoe)", defaultIssuer: "Red Seal Program" },
  ],
  crane_operator: [
    { label: "Red Seal — Mobile Crane Operator", name: "Red Seal — Mobile Crane Operator", defaultIssuer: "Red Seal Program" },
    { label: "Red Seal — Tower Crane Operator", name: "Red Seal — Tower Crane Operator", defaultIssuer: "Red Seal Program" },
  ],
  construction_labourer: [
    { label: "Red Seal — Construction Craft Worker", name: "Red Seal — Construction Craft Worker", defaultIssuer: "Red Seal Program" },
  ],
  lather: [
    { label: "Red Seal — Lather (Interior Systems Mechanic)", name: "Red Seal — Lather (Interior Systems Mechanic)", defaultIssuer: "Red Seal Program" },
  ],

  // ── Personal & food services (Red Seal) ───────────────────────────────────
  baker: [
    { label: "Red Seal — Baker", name: "Red Seal — Baker", defaultIssuer: "Red Seal Program" },
  ],
  cook: [
    { label: "Red Seal — Cook", name: "Red Seal — Cook", defaultIssuer: "Red Seal Program" },
    { label: "Food Handler Certificate", name: "Food Handler Certificate" },
  ],
  hairstylist: [
    { label: "Red Seal — Hairstylist", name: "Red Seal — Hairstylist", defaultIssuer: "Red Seal Program" },
    { label: "Provincial Hairstylist licence", name: "Hairstylist — provincial licence / Certificate of Qualification" },
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
  "BC Housing — Licensing & Consumer Services",
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
