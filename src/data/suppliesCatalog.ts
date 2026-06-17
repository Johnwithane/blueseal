// Per-trade supplies quick-pick — a curated starter list of what a job in each
// trade commonly needs, so the Supplies panel is useful before the tradie even
// types. Each item is a search `query` (NOT a SKU) that deep-links the chosen
// supplier; "Shop" runs it through buildSearchUrl (so it inherits any affiliate
// tag) and "Log expense" pre-fills a job expense.
//
// Coverage is intentionally partial — the highest-volume trades only. A trade
// with no entry falls back to the panel's free-text search; catalogForTrade
// returns [] for it. Keep keys to canonical trade keys (data/trades.ts).
// suppliesCatalog.test.ts enforces shape + that any defaultPartnerId is real.

export interface SupplyItem {
  /** Human label shown in the list, e.g. '1/2" copper pipe'. */
  label: string;
  /** Section heading within the trade, e.g. "Pipe & fittings". */
  group: string;
  /** Search term deep-linked to the supplier. */
  query: string;
  /** Optional preferred partner id (data/supplyPartners.ts). Omit = use the
   *  supplier the tradie has selected in the panel. */
  defaultPartnerId?: string;
}

export const SUPPLIES_CATALOG: Record<string, SupplyItem[]> = {
  plumber: [
    { group: "Pipe & fittings", label: '1/2" copper pipe', query: "1/2 inch copper pipe type L" },
    { group: "Pipe & fittings", label: '1/2" PEX tubing', query: "1/2 inch PEX tubing" },
    { group: "Pipe & fittings", label: '2" ABS / PVC pipe', query: "2 inch ABS DWV pipe" },
    { group: "Pipe & fittings", label: "Push-to-connect fittings", query: "push to connect fittings" },
    { group: "Valves & supply", label: "1/4-turn shut-off valve", query: "quarter turn angle stop valve" },
    { group: "Valves & supply", label: "Braided supply line", query: "braided faucet supply line" },
    { group: "Valves & supply", label: "P-trap kit", query: "p-trap kit" },
    { group: "Seals & sundries", label: "PTFE plumber's tape", query: "ptfe plumbers tape" },
    { group: "Seals & sundries", label: "Wax ring (toilet)", query: "toilet wax ring" },
    { group: "Seals & sundries", label: "Kitchen & bath silicone", query: "kitchen bath silicone sealant" },
  ],
  electrician: [
    { group: "Wire & cable", label: "14/2 NMD90", query: "14/2 NMD90 wire 75m" },
    { group: "Wire & cable", label: "12/2 NMD90", query: "12/2 NMD90 wire" },
    { group: "Wire & cable", label: "Cable staples", query: "NMD90 cable staples" },
    { group: "Devices & boxes", label: "Decora receptacle", query: "decora tamper resistant receptacle" },
    { group: "Devices & boxes", label: "Single-pole switch", query: "single pole light switch decora" },
    { group: "Devices & boxes", label: "Old-work box", query: "old work electrical box" },
    { group: "Devices & boxes", label: "Wire connectors", query: "wire connectors marrette assortment" },
    { group: "Protection & test", label: "AFCI breaker", query: "AFCI circuit breaker" },
    { group: "Protection & test", label: "Non-contact tester", query: "non contact voltage tester" },
    { group: "Protection & test", label: "Electrical tape", query: "electrical tape" },
  ],
  hvac: [
    { group: "Ducting & airflow", label: '6" flexible duct', query: "6 inch insulated flexible duct" },
    { group: "Ducting & airflow", label: "Register / vent cover", query: "floor register vent cover" },
    { group: "Ducting & airflow", label: "Foil duct tape", query: "UL foil HVAC duct tape" },
    { group: "Filters & refrigeration", label: "Furnace filter 16×25×1", query: "furnace filter 16x25x1 MERV" },
    { group: "Filters & refrigeration", label: "Condensate pump", query: "condensate removal pump" },
    { group: "Filters & refrigeration", label: "Line set", query: "mini split line set" },
    { group: "Controls & sundries", label: "Smart thermostat", query: "smart thermostat" },
    { group: "Controls & sundries", label: "Thermostat wire 18/5", query: "18/5 thermostat wire" },
  ],
  carpenter: [
    { group: "Lumber & sheet", label: "2×4 stud", query: "2x4 stud lumber" },
    { group: "Lumber & sheet", label: '1/2" plywood', query: "1/2 inch plywood sheet" },
    { group: "Lumber & sheet", label: "MDF board", query: "MDF board sheet" },
    { group: "Fasteners & hardware", label: '3" construction screws', query: "3 inch construction screws" },
    { group: "Fasteners & hardware", label: "Construction adhesive", query: "construction adhesive" },
    { group: "Fasteners & hardware", label: "Cabinet hinges", query: "concealed cabinet hinges" },
    { group: "Fasteners & hardware", label: "Drawer slides", query: "soft close drawer slides" },
    { group: "Finishing", label: "Wood filler", query: "wood filler" },
    { group: "Finishing", label: "Sandpaper assortment", query: "sandpaper assortment pack" },
  ],
  painter: [
    { group: "Paint & primer", label: "Interior latex paint", query: "interior latex paint" },
    { group: "Paint & primer", label: "Drywall primer", query: "drywall primer sealer" },
    { group: "Paint & primer", label: "Exterior paint", query: "exterior acrylic paint" },
    { group: "Tools & sundries", label: "Roller kit", query: "paint roller kit" },
    { group: "Tools & sundries", label: "Angled sash brush", query: "angled sash paint brush" },
    { group: "Tools & sundries", label: "Painter's tape", query: "blue painters tape" },
    { group: "Tools & sundries", label: "Drop cloth", query: "canvas drop cloth" },
    { group: "Tools & sundries", label: "Spackle / filler", query: "lightweight spackling" },
  ],
  handyman: [
    { group: "Drill & fasten", label: "Drill/driver bit set", query: "cordless drill driver bit set" },
    { group: "Drill & fasten", label: "Wall anchors", query: "drywall wall anchors assortment" },
    { group: "Drill & fasten", label: "Construction screws", query: "construction screws assortment" },
    { group: "Hardware", label: "Cabinet hardware", query: "cabinet handles pulls" },
    { group: "Hardware", label: "Door hinges", query: "interior door hinges" },
    { group: "Hardware", label: "Picture hanging kit", query: "picture hanging kit" },
    { group: "Sundries", label: "Silicone caulk", query: "silicone caulk" },
    { group: "Sundries", label: "Duct tape", query: "duct tape" },
    { group: "Sundries", label: "WD-40", query: "WD-40" },
  ],
  drywall: [
    { group: "Board & compound", label: '1/2" drywall sheet', query: "1/2 inch drywall sheet" },
    { group: "Board & compound", label: "Joint compound", query: "all purpose joint compound" },
    { group: "Tape & finishing", label: "Drywall tape", query: "paper drywall joint tape" },
    { group: "Tape & finishing", label: "Corner bead", query: "metal corner bead" },
    { group: "Tape & finishing", label: "Sanding sponge", query: "drywall sanding sponge" },
    { group: "Fasteners & patch", label: "Drywall screws", query: "drywall screws 1-1/4 inch" },
    { group: "Fasteners & patch", label: "Mesh patch kit", query: "drywall mesh patch kit" },
  ],
  flooring: [
    { group: "Flooring", label: "Vinyl plank (LVP)", query: "luxury vinyl plank flooring" },
    { group: "Flooring", label: "Laminate flooring", query: "laminate flooring" },
    { group: "Flooring", label: "Foam underlayment", query: "flooring foam underlayment" },
    { group: "Trim & adhesive", label: "Transition strip", query: "floor transition strip" },
    { group: "Trim & adhesive", label: "Quarter round", query: "quarter round molding" },
    { group: "Trim & adhesive", label: "Flooring adhesive", query: "vinyl flooring adhesive" },
    { group: "Tools & sundries", label: "Spacers + tapping block", query: "flooring spacers tapping block kit" },
    { group: "Tools & sundries", label: "Knee pads", query: "flooring knee pads" },
  ],
  tiling: [
    { group: "Tile & setting", label: "Ceramic floor tile", query: "ceramic floor tile" },
    { group: "Tile & setting", label: "Thinset mortar", query: "thinset mortar" },
    { group: "Tile & setting", label: "Backer board", query: "cement backer board" },
    { group: "Tile & setting", label: "Tile spacers", query: "tile spacers assortment" },
    { group: "Grout & finishing", label: "Sanded grout", query: "sanded grout" },
    { group: "Grout & finishing", label: "Grout sealer", query: "grout sealer" },
    { group: "Tools", label: "Notched trowel", query: "notched tile trowel" },
    { group: "Tools", label: "Grout float", query: "rubber grout float" },
  ],
  landscaper: [
    { group: "Ground & beds", label: "Landscape fabric", query: "landscape weed barrier fabric" },
    { group: "Ground & beds", label: "Mulch", query: "bagged mulch" },
    { group: "Ground & beds", label: "Topsoil", query: "bagged topsoil" },
    { group: "Hardscape", label: "Paver stones", query: "patio paver stones" },
    { group: "Hardscape", label: "Landscape edging", query: "landscape edging" },
    { group: "Plants & care", label: "Grass seed", query: "grass seed" },
    { group: "Plants & care", label: "Fertilizer", query: "lawn fertilizer" },
    { group: "Sundries", label: "Contractor bags", query: "contractor garbage bags" },
  ],
  roofer: [
    { group: "Roofing materials", label: "Asphalt shingles", query: "asphalt roofing shingles bundle" },
    { group: "Roofing materials", label: "Underlayment", query: "roofing synthetic underlayment" },
    { group: "Roofing materials", label: "Ice & water shield", query: "ice and water shield" },
    { group: "Roofing materials", label: "Drip edge", query: "aluminum drip edge" },
    { group: "Flashing & sealant", label: "Step flashing", query: "step flashing" },
    { group: "Flashing & sealant", label: "Roof cement / sealant", query: "roof cement sealant" },
    { group: "Fasteners & sundries", label: "Roofing nails", query: "roofing nails coil" },
    { group: "Fasteners & sundries", label: "Heavy-duty tarp", query: "heavy duty tarp" },
  ],
};

/** Curated quick-pick items for a trade, or [] if that trade isn't seeded. */
export function catalogForTrade(tradeKey: string): SupplyItem[] {
  return SUPPLIES_CATALOG[tradeKey] ?? [];
}
