export interface TradeOption {
  key: string;
  label: string;
  /**
   * Plural trade noun for empty-state copy — "No <searchPlural> are signed up
   * in <area> yet." Hand-authored (not label + "s") so categories and acronyms
   * read naturally: "HVAC techs", "cleaners", "snow removal services" rather
   * than "HVAC Techs", "Cleanings", "Snow Removals". Lowercase common nouns,
   * preserve acronyms (HVAC, RV).
   */
  searchPlural: string;
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
  { key: "plumber", label: "Plumber", searchPlural: "plumbers", icon: "pi pi-bolt" },
  { key: "electrician", label: "Electrician", searchPlural: "electricians", icon: "pi pi-flash" },
  { key: "hvac", label: "HVAC Tech", searchPlural: "HVAC techs", icon: "pi pi-sun" },
  { key: "carpenter", label: "Carpenter", searchPlural: "carpenters", icon: "pi pi-wrench" },
  { key: "painter", label: "Painter", searchPlural: "painters", icon: "pi pi-palette" },
  { key: "roofer", label: "Roofer", searchPlural: "roofers", icon: "pi pi-home" },
  { key: "landscaper", label: "Landscaper", searchPlural: "landscapers", icon: "pi pi-globe" },
  { key: "handyman", label: "Handyman", searchPlural: "handymen", icon: "pi pi-cog" },
  { key: "appliance_repair", label: "Appliance Repair", searchPlural: "appliance repair techs", icon: "pi pi-desktop" },
  { key: "drywall", label: "Drywall", searchPlural: "drywallers", icon: "pi pi-th-large" },
  { key: "flooring", label: "Flooring", searchPlural: "flooring installers", icon: "pi pi-table" },
  { key: "tiling", label: "Tiling", searchPlural: "tilers", icon: "pi pi-stop" },
  { key: "locksmith", label: "Locksmith", searchPlural: "locksmiths", icon: "pi pi-lock" },
  { key: "pest_control", label: "Pest Control", searchPlural: "pest control techs", icon: "pi pi-shield" },
  { key: "cleaning", label: "Cleaning", searchPlural: "cleaners", icon: "pi pi-sparkles" },

  // ── Construction & structural ───────────────────────────────────────────
  { key: "general_contractor", label: "General Contractor", searchPlural: "general contractors", icon: "pi pi-building" },
  { key: "framer", label: "Framer", searchPlural: "framers", icon: "pi pi-th-large" },
  { key: "mason", label: "Mason / Bricklayer", searchPlural: "masons", icon: "pi pi-stop" },
  { key: "concrete", label: "Concrete / Cement", searchPlural: "concrete contractors", icon: "pi pi-box" },
  { key: "foundation", label: "Foundation Repair", searchPlural: "foundation specialists", icon: "pi pi-building" },
  { key: "welder", label: "Welder", searchPlural: "welders", icon: "pi pi-bolt" },
  { key: "demolition", label: "Demolition", searchPlural: "demolition contractors", icon: "pi pi-trash" },
  { key: "excavation", label: "Excavation / Earthworks", searchPlural: "excavation contractors", icon: "pi pi-truck" },

  // ── Mechanical, gas & low-voltage ───────────────────────────────────────
  { key: "gasfitter", label: "Gas Fitter", searchPlural: "gas fitters", icon: "pi pi-sun" },
  { key: "refrigeration", label: "Refrigeration Tech", searchPlural: "refrigeration techs", icon: "pi pi-cloud" },
  { key: "solar_installer", label: "Solar Installer", searchPlural: "solar installers", icon: "pi pi-sun" },
  { key: "security_systems", label: "Security & Low-Voltage", searchPlural: "security system installers", icon: "pi pi-shield" },
  { key: "network_cabling", label: "Network / Data Cabling", searchPlural: "cabling installers", icon: "pi pi-sitemap" },
  { key: "home_automation", label: "Smart Home / Automation", searchPlural: "smart home installers", icon: "pi pi-wifi" },
  { key: "av_installer", label: "Home Theatre / AV", searchPlural: "home theatre installers", icon: "pi pi-video" },

  // ── Exterior & building envelope ────────────────────────────────────────
  { key: "siding", label: "Siding Installer", searchPlural: "siding installers", icon: "pi pi-clone" },
  { key: "gutters", label: "Eavestrough / Gutters", searchPlural: "eavestrough installers", icon: "pi pi-cloud" },
  { key: "window_installer", label: "Window & Door Installer", searchPlural: "window & door installers", icon: "pi pi-window-maximize" },
  { key: "glazier", label: "Glazier (Glass)", searchPlural: "glaziers", icon: "pi pi-stop" },
  { key: "garage_door", label: "Garage Door Tech", searchPlural: "garage door techs", icon: "pi pi-th-large" },
  { key: "fencing", label: "Fencing", searchPlural: "fence installers", icon: "pi pi-table" },
  { key: "deck_builder", label: "Deck & Patio Builder", searchPlural: "deck & patio builders", icon: "pi pi-table" },
  { key: "stucco", label: "Stucco / Plaster", searchPlural: "stucco & plaster specialists", icon: "pi pi-clone" },
  { key: "waterproofing", label: "Waterproofing", searchPlural: "waterproofing specialists", icon: "pi pi-cloud" },
  { key: "insulation", label: "Insulation", searchPlural: "insulation installers", icon: "pi pi-cloud" },

  // ── Interior & finishing ────────────────────────────────────────────────
  { key: "cabinetry", label: "Cabinetry / Millwork", searchPlural: "cabinetmakers", icon: "pi pi-th-large" },
  { key: "countertop", label: "Countertop Installer", searchPlural: "countertop installers", icon: "pi pi-table" },
  { key: "wallpaper", label: "Wallpaper / Wall Covering", searchPlural: "wallpaper installers", icon: "pi pi-palette" },
  { key: "window_treatments", label: "Blinds & Window Treatments", searchPlural: "window treatment installers", icon: "pi pi-table" },

  // ── Outdoor & grounds ───────────────────────────────────────────────────
  { key: "arborist", label: "Arborist / Tree Service", searchPlural: "arborists", icon: "pi pi-globe" },
  { key: "irrigation", label: "Irrigation / Sprinklers", searchPlural: "irrigation specialists", icon: "pi pi-globe" },
  { key: "hardscaping", label: "Hardscaping / Paving", searchPlural: "hardscaping contractors", icon: "pi pi-stop" },
  { key: "snow_removal", label: "Snow Removal", searchPlural: "snow removal services", icon: "pi pi-cloud" },
  { key: "pool_spa", label: "Pool & Spa Service", searchPlural: "pool & spa techs", icon: "pi pi-globe" },
  { key: "septic", label: "Septic Services", searchPlural: "septic specialists", icon: "pi pi-globe" },

  // ── Specialty services ──────────────────────────────────────────────────
  { key: "duct_cleaning", label: "Duct Cleaning", searchPlural: "duct cleaners", icon: "pi pi-cloud" },
  { key: "pressure_washing", label: "Pressure Washing", searchPlural: "pressure washing services", icon: "pi pi-sparkles" },
  { key: "window_cleaning", label: "Window Cleaning", searchPlural: "window cleaners", icon: "pi pi-sparkles" },
  { key: "chimney_sweep", label: "Chimney Sweep", searchPlural: "chimney sweeps", icon: "pi pi-home" },
  { key: "junk_removal", label: "Junk Removal / Hauling", searchPlural: "junk removal services", icon: "pi pi-trash" },
  { key: "moving", label: "Moving Services", searchPlural: "movers", icon: "pi pi-truck" },
  { key: "home_inspection", label: "Home Inspector", searchPlural: "home inspectors", icon: "pi pi-verified" },

  // ── Automotive & vehicle ────────────────────────────────────────────────
  // Red Seal trades. Less common on a home job board, but Blue Seal verifies
  // the certified tradesperson — so they belong in the canonical roster.
  { key: "auto_service", label: "Automotive Service Tech", searchPlural: "automotive service techs", icon: "pi pi-car" },
  { key: "auto_body", label: "Auto Body & Collision", searchPlural: "auto body techs", icon: "pi pi-car" },
  { key: "auto_refinishing", label: "Automotive Refinishing", searchPlural: "automotive refinishers", icon: "pi pi-palette" },
  { key: "truck_transport_mechanic", label: "Truck & Transport Mechanic", searchPlural: "truck & transport mechanics", icon: "pi pi-truck" },
  { key: "transport_trailer_tech", label: "Transport Trailer Tech", searchPlural: "transport trailer techs", icon: "pi pi-truck" },
  { key: "heavy_duty_mechanic", label: "Heavy Duty Equipment Tech", searchPlural: "heavy duty equipment techs", icon: "pi pi-truck" },
  { key: "ag_equipment_tech", label: "Agricultural Equipment Tech", searchPlural: "agricultural equipment techs", icon: "pi pi-truck" },
  { key: "motorcycle_tech", label: "Motorcycle Tech", searchPlural: "motorcycle techs", icon: "pi pi-cog" },
  { key: "rv_tech", label: "RV Service Tech", searchPlural: "RV techs", icon: "pi pi-truck" },

  // ── Industrial, metal & machining ───────────────────────────────────────
  { key: "millwright", label: "Millwright (Industrial Mechanic)", searchPlural: "millwrights", icon: "pi pi-cog" },
  { key: "machinist", label: "Machinist", searchPlural: "machinists", icon: "pi pi-cog" },
  { key: "tool_and_die", label: "Tool & Die Maker", searchPlural: "tool & die makers", icon: "pi pi-cog" },
  { key: "metal_fabricator", label: "Metal Fabricator (Fitter)", searchPlural: "metal fabricators", icon: "pi pi-box" },
  { key: "sheet_metal", label: "Sheet Metal Worker", searchPlural: "sheet metal workers", icon: "pi pi-clone" },
  { key: "boilermaker", label: "Boilermaker", searchPlural: "boilermakers", icon: "pi pi-box" },
  { key: "ironworker", label: "Ironworker", searchPlural: "ironworkers", icon: "pi pi-th-large" },
  { key: "instrumentation_tech", label: "Instrumentation & Control Tech", searchPlural: "instrumentation techs", icon: "pi pi-gauge" },
  { key: "parts_technician", label: "Parts Technician", searchPlural: "parts technicians", icon: "pi pi-warehouse" },

  // ── Industrial mechanical, electrical & process ─────────────────────────
  { key: "industrial_electrician", label: "Industrial Electrician", searchPlural: "industrial electricians", icon: "pi pi-bolt" },
  { key: "powerline_tech", label: "Powerline Technician", searchPlural: "powerline technicians", icon: "pi pi-bolt" },
  { key: "steamfitter", label: "Steamfitter / Pipefitter", searchPlural: "steamfitters", icon: "pi pi-wrench" },
  { key: "sprinkler_fitter", label: "Fire Sprinkler Fitter", searchPlural: "fire sprinkler fitters", icon: "pi pi-shield" },
  { key: "oil_heat_tech", label: "Oil Heat System Tech", searchPlural: "oil heat techs", icon: "pi pi-sun" },

  // ── Construction & site operations ──────────────────────────────────────
  { key: "heavy_equipment_operator", label: "Heavy Equipment Operator", searchPlural: "heavy equipment operators", icon: "pi pi-truck" },
  { key: "crane_operator", label: "Crane Operator", searchPlural: "crane operators", icon: "pi pi-truck" },
  { key: "construction_labourer", label: "Construction Craft Worker", searchPlural: "construction craft workers", icon: "pi pi-users" },
  { key: "lather", label: "Lather / Interior Systems", searchPlural: "lathers", icon: "pi pi-th-large" },

  // ── Personal & food services ────────────────────────────────────────────
  { key: "baker", label: "Baker", searchPlural: "bakers", icon: "pi pi-shopping-bag" },
  { key: "cook", label: "Cook / Chef", searchPlural: "cooks & chefs", icon: "pi pi-shopping-cart" },
  { key: "hairstylist", label: "Hairstylist", searchPlural: "hairstylists", icon: "pi pi-user" },
];

export function tradeLabel(key: string): string {
  return TRADES.find((t) => t.key === key)?.label ?? key;
}

// Plural trade noun for empty-state / "none nearby" copy. Falls back to the
// label (then the raw key) for an unknown key so callers never render blank.
export function tradePlural(key: string): string {
  return TRADES.find((t) => t.key === key)?.searchPlural ?? tradeLabel(key);
}
