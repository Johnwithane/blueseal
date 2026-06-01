import { z } from "zod";

// Shared contract for one importable seeded-prospect row. The local research
// tool (tools/seed-research) emits rows in this shape; bulkImportProspects
// re-validates every row with the SAME schema before writing — the server is
// the source of truth, the file is a proposal.
//
// Canonical trade keys — MIRROR of src/data/trades.ts (same order). The
// functions/ package can't import from src/, so this is duplicated deliberately
// (same cross-package pattern as NotificationType in lib/notify.ts). The drift
// guard tests/trades-sync.test.ts fails the test run if this list ever diverges
// from src/data/trades.ts, so they stay identical. An unknown trade key fails
// validation rather than seeding a listing search can never surface.
export const TRADE_KEYS = [
  // Core mechanical & common
  "plumber",
  "electrician",
  "hvac",
  "carpenter",
  "painter",
  "roofer",
  "landscaper",
  "handyman",
  "appliance_repair",
  "drywall",
  "flooring",
  "tiling",
  "locksmith",
  "pest_control",
  "cleaning",
  // Construction & structural
  "general_contractor",
  "framer",
  "mason",
  "concrete",
  "foundation",
  "welder",
  "demolition",
  "excavation",
  // Mechanical, gas & low-voltage
  "gasfitter",
  "refrigeration",
  "solar_installer",
  "security_systems",
  "network_cabling",
  "home_automation",
  "av_installer",
  // Exterior & building envelope
  "siding",
  "gutters",
  "window_installer",
  "glazier",
  "garage_door",
  "fencing",
  "deck_builder",
  "stucco",
  "waterproofing",
  "insulation",
  // Interior & finishing
  "cabinetry",
  "countertop",
  "wallpaper",
  "window_treatments",
  // Outdoor & grounds
  "arborist",
  "irrigation",
  "hardscaping",
  "snow_removal",
  "pool_spa",
  "septic",
  // Specialty services
  "duct_cleaning",
  "pressure_washing",
  "window_cleaning",
  "chimney_sweep",
  "junk_removal",
  "moving",
  "home_inspection",
] as const;

const tradeKey = z.enum(TRADE_KEYS);

// Where the row was discovered. Drives provenance display + audit.
export const PROSPECT_SOURCE_REGISTRIES = [
  "kelowna_open_data",
  "orgbook_bc",
  "technical_safety_bc",
  "skilledtradesbc",
  "industry_association",
] as const;

// The CASL/PIPEDA consent posture for the row (mirrors ProspectDataBasis in
// src/firebase/interfaces.ts).
export const PROSPECT_DATA_BASES = [
  "open_data",
  "public_registry",
  "industry_association",
  "manual_public_lookup",
] as const;

export const seededProspectRowSchema = z.object({
  // Stable dedup key (e.g. normalized `businessName|licenceNumber`). The import
  // hashes this into a deterministic prospect doc id, so re-importing the same
  // row is idempotent (skipped as a dupe).
  externalKey: z.string().trim().min(1).max(200),

  // Discovery / profile fields.
  displayName: z.string().trim().min(1).max(120),
  businessName: z.string().trim().max(160).nullable().default(null),
  bio: z.string().trim().max(1000).default(""),
  primaryTrade: tradeKey,
  secondaryTrades: z.array(tradeKey).max(3).default([]),
  yearsExperience: z.number().int().min(0).max(80).nullable().default(null),
  pricingModel: z.enum(["hourly", "quote", "both"]).default("quote"),
  hourlyRate: z.number().int().min(0).max(100_000).nullable().default(null), // cents
  languages: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  serviceRadiusKm: z.number().min(1).max(200).default(25),
  locationApprox: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),

  // Contact. A usable email is REQUIRED: the whole loop (claim-by-email +
  // outreach-on-request) needs one, and CASL implied consent rests on a
  // conspicuously published business email — a listing with no email could
  // never be claimed or contacted, so we don't seed it.
  publicEmail: z.string().trim().email().max(200),
  publicPhone: z.string().trim().max(40).nullable().default(null),
  website: z.string().trim().url().max(300).nullable().default(null),
  licenceNumber: z.string().trim().max(80).nullable().default(null),

  // Provenance / CASL.
  sourceRegistry: z.enum(PROSPECT_SOURCE_REGISTRIES),
  source: z.string().trim().min(1).max(160), // human label, e.g. registry name
  sourceUrl: z.string().trim().url().max(500).nullable().default(null),
  dataBasis: z.enum(PROSPECT_DATA_BASES),
  // True only if the email was conspicuously published with no "no unsolicited
  // mail" statement — the CASL implied-consent gate. Phase 3 outreach refuses
  // rows where this is false.
  emailConspicuouslyPublished: z.boolean(),
});

export type SeededProspectRow = z.infer<typeof seededProspectRowSchema>;
