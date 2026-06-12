/**
 * Trade-specific expert persona for the AI assistant.
 *
 * The generic assistant doesn't know what trade the caller practices, so on a
 * general thread a plumber gets generic, deflecting answers. This module turns
 * a tradesperson's registered trade(s) into an expert-persona system-prompt
 * fragment: the assistant answers as a working specialist in their trade —
 * concrete how-to (install / set up / diagnose / spec / materials), Canadian
 * code + units framing, and clear scope / permit / safety flags. It stays
 * flexible on adjacent and trades-business questions rather than refusing.
 *
 * Pure module (no firebase imports) so it's unit-testable from the root vitest
 * — the same cross-package boundary as functions/src/seed/seededProspectSchema.
 *
 * TRADE_LABELS is a MIRROR of key→label in src/data/trades.ts (the functions
 * package can't import from src/). The drift guard tests/trades-sync.test.ts
 * fails the test run if the two ever diverge — the same pattern as TRADE_KEYS.
 */

export const TRADE_LABELS: Record<string, string> = {
  // Core mechanical & common
  plumber: "Plumber",
  electrician: "Electrician",
  hvac: "HVAC Tech",
  carpenter: "Carpenter",
  painter: "Painter",
  roofer: "Roofer",
  landscaper: "Landscaper",
  handyman: "Handyman",
  appliance_repair: "Appliance Repair",
  drywall: "Drywall",
  flooring: "Flooring",
  tiling: "Tiling",
  locksmith: "Locksmith",
  pest_control: "Pest Control",
  cleaning: "Cleaning",
  // Construction & structural
  general_contractor: "General Contractor",
  framer: "Framer",
  mason: "Mason / Bricklayer",
  concrete: "Concrete / Cement",
  foundation: "Foundation Repair",
  welder: "Welder",
  demolition: "Demolition",
  excavation: "Excavation / Earthworks",
  // Mechanical, gas & low-voltage
  gasfitter: "Gas Fitter",
  refrigeration: "Refrigeration Tech",
  solar_installer: "Solar Installer",
  security_systems: "Security & Low-Voltage",
  network_cabling: "Network / Data Cabling",
  home_automation: "Smart Home / Automation",
  av_installer: "Home Theatre / AV",
  // Exterior & building envelope
  siding: "Siding Installer",
  gutters: "Eavestrough / Gutters",
  window_installer: "Window & Door Installer",
  glazier: "Glazier (Glass)",
  garage_door: "Garage Door Tech",
  fencing: "Fencing",
  deck_builder: "Deck & Patio Builder",
  stucco: "Stucco / Plaster",
  waterproofing: "Waterproofing",
  insulation: "Insulation",
  // Interior & finishing
  cabinetry: "Cabinetry / Millwork",
  countertop: "Countertop Installer",
  wallpaper: "Wallpaper / Wall Covering",
  window_treatments: "Blinds & Window Treatments",
  // Outdoor & grounds
  arborist: "Arborist / Tree Service",
  irrigation: "Irrigation / Sprinklers",
  hardscaping: "Hardscaping / Paving",
  snow_removal: "Snow Removal",
  pool_spa: "Pool & Spa Service",
  septic: "Septic Services",
  // Specialty services
  duct_cleaning: "Duct Cleaning",
  pressure_washing: "Pressure Washing",
  window_cleaning: "Window Cleaning",
  chimney_sweep: "Chimney Sweep",
  junk_removal: "Junk Removal / Hauling",
  moving: "Moving Services",
  home_inspection: "Home Inspector",
  // Automotive & vehicle
  auto_service: "Automotive Service Tech",
  auto_body: "Auto Body & Collision",
  auto_refinishing: "Automotive Refinishing",
  truck_transport_mechanic: "Truck & Transport Mechanic",
  transport_trailer_tech: "Transport Trailer Tech",
  heavy_duty_mechanic: "Heavy Duty Equipment Tech",
  ag_equipment_tech: "Agricultural Equipment Tech",
  motorcycle_tech: "Motorcycle Tech",
  rv_tech: "RV Service Tech",
  // Industrial, metal & machining
  millwright: "Millwright (Industrial Mechanic)",
  machinist: "Machinist",
  tool_and_die: "Tool & Die Maker",
  metal_fabricator: "Metal Fabricator (Fitter)",
  sheet_metal: "Sheet Metal Worker",
  boilermaker: "Boilermaker",
  ironworker: "Ironworker",
  instrumentation_tech: "Instrumentation & Control Tech",
  parts_technician: "Parts Technician",
  // Industrial mechanical, electrical & process
  industrial_electrician: "Industrial Electrician",
  powerline_tech: "Powerline Technician",
  steamfitter: "Steamfitter / Pipefitter",
  sprinkler_fitter: "Fire Sprinkler Fitter",
  oil_heat_tech: "Oil Heat System Tech",
  // Construction & site operations
  heavy_equipment_operator: "Heavy Equipment Operator",
  crane_operator: "Crane Operator",
  construction_labourer: "Construction Craft Worker",
  lather: "Lather / Interior Systems",
  // Personal & food services
  baker: "Baker",
  cook: "Cook / Chef",
  hairstylist: "Hairstylist",
};

/**
 * Curated, QUALITATIVE focus notes for high-volume / safety-critical trades.
 * Deliberately not code section numbers or hard specs — those would be easy to
 * get wrong and the model already carries the domain knowledge; this is steering
 * toward the systems a pro in that trade actually works on. Trades without an
 * entry fall back to the template (still a full expert persona, just no extra
 * focus line).
 */
const TRADE_FOCUS: Record<string, string> = {
  plumber:
    "supply and DWV systems, fixtures and valves, tank and tankless water heaters, " +
    "backflow prevention, venting, and pipe materials and joining methods",
  electrician:
    "panels and circuits, device and fixture installs, grounding and bonding, load " +
    "calculations, and troubleshooting faults",
  hvac:
    "furnaces, heat pumps and AC, refrigerant handling, ducting and airflow, " +
    "thermostats and controls, and commissioning",
  gasfitter:
    "appliance connections, line sizing and pressure testing, venting and combustion " +
    "air, and leak diagnosis",
  carpenter:
    "framing, finish carpentry, fastening and materials, squaring and levelling, and " +
    "moisture and structural detailing",
  roofer:
    "underlayment and flashing, shingle and membrane systems, ventilation, and leak " +
    "tracing",
  refrigeration: "sealed systems, refrigerant charging, compressors, and controls",
};

export interface TradeExpertiseInput {
  /** The trade to lead the persona with: job.trade on a job thread, else trades[0]. */
  leadTradeKey: string | null;
  /** Every registered trade key — the lead is filtered out for the "also works as" clause. */
  otherTradeKeys: string[];
  /** Years of experience for the lead trade, if known. Dropped from the copy when null/0. */
  yearsForLead: number | null;
}

function labelFor(key: string): string {
  return TRADE_LABELS[key] ?? key;
}

/** "A" → "A"; "A","B" → "A and B"; "A","B","C" → "A, B and C". */
function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Build the expert-persona system-prompt fragment for a tradesperson, or null
 * when there's no trade to lead with (a draft profile with no trades yet) — the
 * caller then falls back to the generic assistant base prompt.
 */
export function buildTradeExpertisePrompt(input: TradeExpertiseInput): string | null {
  const { leadTradeKey, otherTradeKeys, yearsForLead } = input;
  if (!leadTradeKey) return null;

  const leadLabel = labelFor(leadTradeKey);

  const yearsClause =
    yearsForLead && yearsForLead > 0
      ? ` with ${yearsForLead} ${yearsForLead === 1 ? "year" : "years"} of hands-on field experience`
      : "";

  const others = otherTradeKeys.filter((k) => k && k !== leadTradeKey).map(labelFor);
  const alsoClause = others.length ? ` (who also works as ${joinWithAnd(others)})` : "";

  const intro =
    `You are a master ${leadLabel}${yearsClause}, mentoring a fellow ${leadLabel} in Canada${alsoClause}. ` +
    "Answer as a working expert in this trade: give practical, hands-on guidance on " +
    "installation, setup, commissioning, diagnosis, repair, sizing, and materials and parts " +
    "selection — the concrete steps you'd take on site. When the user asks how to do or set " +
    "something up, walk them through it (steps, specs, what to watch for) instead of deflecting.";

  const scopeFlag =
    "Work to the applicable provincial and municipal codes, and flag clearly when a job needs " +
    "a permit, an inspection, or work that falls under a different licensed trade than yours.";

  const focus = TRADE_FOCUS[leadTradeKey];
  const focusLine = focus
    ? `\nFocus areas for a ${leadLabel}: ${focus}. ${scopeFlag}`
    : `\n${scopeFlag}`;

  const tail =
    "\nYou also know Blue Seal itself — how jobs, quotes, invoices, scheduling and payments " +
    "work in the app — and can explain those when asked. Stay in expert mode for adjacent and " +
    "trades-business questions too, just be clear when something falls outside your licensed " +
    'scope. Use Canadian spelling (e.g. "metre", "colour"), Canadian dollars (CAD), and metric ' +
    "units. If you're missing a detail you need, ask one focused follow-up question rather than " +
    "guessing.";

  return intro + focusLine + tail;
}
