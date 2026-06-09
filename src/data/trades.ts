export interface TradeOption {
  key: string;
  label: string;
  icon: string; // PrimeIcons name
}

// CANONICAL trade list — the single source of truth for the whole client:
// the onboarding trade picker, search filters, and the Zod trade enum in
// src/validation/schemas.ts (which derives `tradeKeyEnum` from these keys) all
// read from here. Add a trade once, here, and it flows everywhere on the
// client.
//
// The Cloud Functions package can't import from src/, so the seed-import
// schema (functions/src/seed/seededProspectSchema.ts → TRADE_KEYS) keeps a
// mirror of these keys. A drift guard (tests/trades-sync.test.ts) fails the
// test run if the two ever diverge, so the list stays "full" in both places.
//
// IMPORTANT: keys are stable identifiers stored on tradesperson + job docs —
// never rename or remove a key once shipped (you'd orphan existing data). Only
// add. Labels and icons are safe to change. Order here is the display order in
// the picker/filter (common trades first).
export const TRADES: TradeOption[] = [
  // ── Core mechanical & common ────────────────────────────────────────────
  { key: "plumber", label: "Plumber", icon: "pi pi-bolt" },
  { key: "electrician", label: "Electrician", icon: "pi pi-flash" },
  { key: "hvac", label: "HVAC Tech", icon: "pi pi-sun" },
  { key: "carpenter", label: "Carpenter", icon: "pi pi-wrench" },
  { key: "painter", label: "Painter", icon: "pi pi-palette" },
  { key: "roofer", label: "Roofer", icon: "pi pi-home" },
  { key: "landscaper", label: "Landscaper", icon: "pi pi-globe" },
  { key: "handyman", label: "Handyman", icon: "pi pi-cog" },
  { key: "appliance_repair", label: "Appliance Repair", icon: "pi pi-desktop" },
  { key: "drywall", label: "Drywall", icon: "pi pi-th-large" },
  { key: "flooring", label: "Flooring", icon: "pi pi-table" },
  { key: "tiling", label: "Tiling", icon: "pi pi-stop" },
  { key: "locksmith", label: "Locksmith", icon: "pi pi-lock" },
  { key: "pest_control", label: "Pest Control", icon: "pi pi-shield" },
  { key: "cleaning", label: "Cleaning", icon: "pi pi-sparkles" },

  // ── Construction & structural ───────────────────────────────────────────
  { key: "general_contractor", label: "General Contractor", icon: "pi pi-building" },
  { key: "framer", label: "Framer", icon: "pi pi-th-large" },
  { key: "mason", label: "Mason / Bricklayer", icon: "pi pi-stop" },
  { key: "concrete", label: "Concrete / Cement", icon: "pi pi-box" },
  { key: "foundation", label: "Foundation Repair", icon: "pi pi-building" },
  { key: "welder", label: "Welder", icon: "pi pi-bolt" },
  { key: "demolition", label: "Demolition", icon: "pi pi-trash" },
  { key: "excavation", label: "Excavation / Earthworks", icon: "pi pi-truck" },

  // ── Mechanical, gas & low-voltage ───────────────────────────────────────
  { key: "gasfitter", label: "Gas Fitter", icon: "pi pi-sun" },
  { key: "refrigeration", label: "Refrigeration Tech", icon: "pi pi-cloud" },
  { key: "solar_installer", label: "Solar Installer", icon: "pi pi-sun" },
  { key: "security_systems", label: "Security & Low-Voltage", icon: "pi pi-shield" },
  { key: "network_cabling", label: "Network / Data Cabling", icon: "pi pi-sitemap" },
  { key: "home_automation", label: "Smart Home / Automation", icon: "pi pi-wifi" },
  { key: "av_installer", label: "Home Theatre / AV", icon: "pi pi-video" },

  // ── Exterior & building envelope ────────────────────────────────────────
  { key: "siding", label: "Siding Installer", icon: "pi pi-clone" },
  { key: "gutters", label: "Eavestrough / Gutters", icon: "pi pi-cloud" },
  { key: "window_installer", label: "Window & Door Installer", icon: "pi pi-window-maximize" },
  { key: "glazier", label: "Glazier (Glass)", icon: "pi pi-stop" },
  { key: "garage_door", label: "Garage Door Tech", icon: "pi pi-th-large" },
  { key: "fencing", label: "Fencing", icon: "pi pi-table" },
  { key: "deck_builder", label: "Deck & Patio Builder", icon: "pi pi-table" },
  { key: "stucco", label: "Stucco / Plaster", icon: "pi pi-clone" },
  { key: "waterproofing", label: "Waterproofing", icon: "pi pi-cloud" },
  { key: "insulation", label: "Insulation", icon: "pi pi-cloud" },

  // ── Interior & finishing ────────────────────────────────────────────────
  { key: "cabinetry", label: "Cabinetry / Millwork", icon: "pi pi-th-large" },
  { key: "countertop", label: "Countertop Installer", icon: "pi pi-table" },
  { key: "wallpaper", label: "Wallpaper / Wall Covering", icon: "pi pi-palette" },
  { key: "window_treatments", label: "Blinds & Window Treatments", icon: "pi pi-table" },

  // ── Outdoor & grounds ───────────────────────────────────────────────────
  { key: "arborist", label: "Arborist / Tree Service", icon: "pi pi-globe" },
  { key: "irrigation", label: "Irrigation / Sprinklers", icon: "pi pi-globe" },
  { key: "hardscaping", label: "Hardscaping / Paving", icon: "pi pi-stop" },
  { key: "snow_removal", label: "Snow Removal", icon: "pi pi-cloud" },
  { key: "pool_spa", label: "Pool & Spa Service", icon: "pi pi-globe" },
  { key: "septic", label: "Septic Services", icon: "pi pi-globe" },

  // ── Specialty services ──────────────────────────────────────────────────
  { key: "duct_cleaning", label: "Duct Cleaning", icon: "pi pi-cloud" },
  { key: "pressure_washing", label: "Pressure Washing", icon: "pi pi-sparkles" },
  { key: "window_cleaning", label: "Window Cleaning", icon: "pi pi-sparkles" },
  { key: "chimney_sweep", label: "Chimney Sweep", icon: "pi pi-home" },
  { key: "junk_removal", label: "Junk Removal / Hauling", icon: "pi pi-trash" },
  { key: "moving", label: "Moving Services", icon: "pi pi-truck" },
  { key: "home_inspection", label: "Home Inspector", icon: "pi pi-verified" },

  // ── Automotive & vehicle ────────────────────────────────────────────────
  // Red Seal trades. Less common on a home job board, but Blue Seal verifies
  // the certified tradesperson — so they belong in the canonical roster.
  { key: "auto_service", label: "Automotive Service Tech", icon: "pi pi-car" },
  { key: "auto_body", label: "Auto Body & Collision", icon: "pi pi-car" },
  { key: "auto_refinishing", label: "Automotive Refinishing", icon: "pi pi-palette" },
  { key: "truck_transport_mechanic", label: "Truck & Transport Mechanic", icon: "pi pi-truck" },
  { key: "transport_trailer_tech", label: "Transport Trailer Tech", icon: "pi pi-truck" },
  { key: "heavy_duty_mechanic", label: "Heavy Duty Equipment Tech", icon: "pi pi-truck" },
  { key: "ag_equipment_tech", label: "Agricultural Equipment Tech", icon: "pi pi-truck" },
  { key: "motorcycle_tech", label: "Motorcycle Tech", icon: "pi pi-cog" },
  { key: "rv_tech", label: "RV Service Tech", icon: "pi pi-truck" },

  // ── Industrial, metal & machining ───────────────────────────────────────
  { key: "millwright", label: "Millwright (Industrial Mechanic)", icon: "pi pi-cog" },
  { key: "machinist", label: "Machinist", icon: "pi pi-cog" },
  { key: "tool_and_die", label: "Tool & Die Maker", icon: "pi pi-cog" },
  { key: "metal_fabricator", label: "Metal Fabricator (Fitter)", icon: "pi pi-box" },
  { key: "sheet_metal", label: "Sheet Metal Worker", icon: "pi pi-clone" },
  { key: "boilermaker", label: "Boilermaker", icon: "pi pi-box" },
  { key: "ironworker", label: "Ironworker", icon: "pi pi-th-large" },
  { key: "instrumentation_tech", label: "Instrumentation & Control Tech", icon: "pi pi-gauge" },
  { key: "parts_technician", label: "Parts Technician", icon: "pi pi-warehouse" },

  // ── Industrial mechanical, electrical & process ─────────────────────────
  { key: "industrial_electrician", label: "Industrial Electrician", icon: "pi pi-bolt" },
  { key: "powerline_tech", label: "Powerline Technician", icon: "pi pi-bolt" },
  { key: "steamfitter", label: "Steamfitter / Pipefitter", icon: "pi pi-wrench" },
  { key: "sprinkler_fitter", label: "Fire Sprinkler Fitter", icon: "pi pi-shield" },
  { key: "oil_heat_tech", label: "Oil Heat System Tech", icon: "pi pi-sun" },

  // ── Construction & site operations ──────────────────────────────────────
  { key: "heavy_equipment_operator", label: "Heavy Equipment Operator", icon: "pi pi-truck" },
  { key: "crane_operator", label: "Crane Operator", icon: "pi pi-truck" },
  { key: "construction_labourer", label: "Construction Craft Worker", icon: "pi pi-users" },
  { key: "lather", label: "Lather / Interior Systems", icon: "pi pi-th-large" },

  // ── Personal & food services ────────────────────────────────────────────
  { key: "baker", label: "Baker", icon: "pi pi-shopping-bag" },
  { key: "cook", label: "Cook / Chef", icon: "pi pi-shopping-cart" },
  { key: "hairstylist", label: "Hairstylist", icon: "pi pi-user" },
];

export function tradeLabel(key: string): string {
  return TRADES.find((t) => t.key === key)?.label ?? key;
}
