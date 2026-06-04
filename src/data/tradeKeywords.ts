import { TRADES, type TradeOption } from "@/data/trades";

// ---------------------------------------------------------------------------
// "Describe what you need" → trade suggestions.
//
// A lot of clients don't know the trade name — they know the symptom ("my sink
// is leaking", "power keeps tripping", "need a new fence"). This is the instant,
// offline, zero-cost first pass that maps plain-English descriptions to one or
// more canonical trade keys, so the client can tap a suggestion instead of
// scrolling a 60-item dropdown.
//
// How matching works (see `suggestTrades` below): the query is normalised and
// each keyword is matched at a WORD BOUNDARY as a prefix — so "leak" also
// catches "leaking"/"leaks", and "fence" catches "fences". Multi-word keywords
// ("water heater", "new fence") are stronger signals and score by their word
// count, so the specific trade out-ranks an incidental single-word hit.
//
// This is intentionally a curated lexicon, not an exhaustive one. It's the
// cheap 80% pass; the AI matcher (Vertex/Gemini, shipped separately) is the
// fallback for phrasing the lexicon misses. When you add a trade to trades.ts,
// add a keyword line here too — the integrity test in tradeKeywords.test.ts
// fails if a trade has no keywords or a keyword points at an unknown trade.
//
// Keep keywords lowercase, base form (singular, no -ing). Overlap across trades
// is fine and expected — that's how we surface 2-3 sensible suggestions.
// ---------------------------------------------------------------------------

export const TRADE_KEYWORDS: Record<string, string[]> = {
  // ── Core mechanical & common ────────────────────────────────────────────
  plumber: [
    "plumber", "plumbing", "sink", "tap", "faucet", "toilet", "leak", "drip",
    "drain", "clog", "blocked", "pipe", "water heater", "hot water tank",
    "no hot water", "sewer", "sump pump", "shower", "bathtub", "tub",
    "garbage disposal", "water pressure", "burst pipe", "overflow", "flooded",
    "water leak", "running toilet", "low water pressure",
  ],
  electrician: [
    "electrician", "electrical", "power", "outlet", "socket", "plug", "switch",
    "light", "flicker", "breaker", "fuse", "tripping", "trip", "panel",
    "wiring", "wire", "spark", "shock", "no power", "dead outlet", "gfci",
    "ceiling fan", "dimmer", "ev charger", "pot lights", "electric",
  ],
  hvac: [
    "hvac", "furnace", "air conditioner", "air conditioning", "air con",
    "heating", "no heat", "cooling", "thermostat", "heat pump", "boiler",
    "radiator", "blowing cold", "blowing hot", "condenser", "mini split",
    "ac unit", "central air",
  ],
  carpenter: [
    "carpenter", "carpentry", "wood", "woodwork", "trim", "baseboard", "door",
    "frame", "shelf", "shelving", "stairs", "joinery", "molding", "moulding",
    "crown molding", "custom wood",
  ],
  painter: [
    "painter", "paint", "repaint", "primer", "stain", "varnish",
    "interior paint", "exterior paint", "wall colour", "wall color",
  ],
  roofer: [
    "roofer", "roof", "roofing", "shingle", "roof leak", "flashing", "soffit",
    "fascia", "ridge cap", "re-roof", "roof repair", "leaking roof",
  ],
  landscaper: [
    "landscaper", "landscaping", "lawn", "grass", "mow", "yard", "garden",
    "sod", "mulch", "planting", "hedge", "weeds", "flower bed", "lawn care",
  ],
  handyman: [
    "handyman", "odd job", "small job", "tv mount", "mount", "hang", "assemble",
    "assembly", "flat pack", "ikea", "furniture assembly", "picture hanging",
    "curtain rod", "patch", "caulk", "caulking", "door knob", "drawer",
    "weatherstrip", "around the house",
  ],
  appliance_repair: [
    "appliance", "dishwasher", "washing machine", "washer", "dryer", "fridge",
    "refrigerator", "freezer", "oven", "stove", "range", "microwave",
    "ice maker", "broken appliance", "dryer not heating",
  ],
  drywall: [
    "drywall", "sheetrock", "plaster", "gyprock", "hole in wall", "wall crack",
    "ceiling crack", "patch wall", "taping", "mudding", "drywall repair",
  ],
  flooring: [
    "flooring", "floor", "hardwood", "laminate", "vinyl plank", "lvp", "carpet",
    "subfloor", "refinish floor", "squeaky floor", "floorboard",
  ],
  tiling: [
    "tiling", "tile", "backsplash", "grout", "regrout", "shower tile",
    "floor tile", "mosaic", "ceramic tile", "porcelain tile",
  ],
  locksmith: [
    "locksmith", "lock", "locked out", "key", "deadbolt", "rekey",
    "change locks", "lockout", "door lock", "broken key", "smart lock",
  ],
  pest_control: [
    "pest", "mice", "mouse", "rat", "rodent", "ant", "cockroach", "roach",
    "bug", "termite", "wasp", "bee", "hornet", "bed bug", "infestation",
    "exterminator", "raccoon", "squirrel", "wildlife",
  ],
  cleaning: [
    "cleaning", "cleaner", "housekeeping", "deep clean", "move out clean",
    "maid", "tidy", "house clean",
  ],

  // ── Construction & structural ───────────────────────────────────────────
  general_contractor: [
    "general contractor", "renovation", "renovate", "gut reno", "remodel",
    "addition", "extension", "basement finish", "kitchen remodel",
    "bathroom remodel", "contractor", "permit",
  ],
  framer: ["framer", "framing", "stud", "wall framing", "structural framing"],
  mason: [
    "mason", "brick", "brickwork", "masonry", "mortar", "repointing",
    "block wall", "stone wall", "tuckpointing",
  ],
  concrete: [
    "concrete", "cement", "driveway", "slab", "sidewalk", "footing",
    "concrete pour", "patio slab", "concrete crack", "garage floor",
  ],
  foundation: [
    "foundation", "settling", "foundation crack", "bowing wall", "underpinning",
    "crawl space", "structural crack", "basement crack",
  ],
  welder: [
    "welder", "weld", "welding", "metal fabrication", "fabricate", "railing",
    "steel", "wrought iron",
  ],
  demolition: ["demolition", "demolish", "tear down", "knock down", "demo", "remove wall"],
  excavation: [
    "excavation", "excavate", "digging", "trench", "grading", "earthworks",
    "backfill", "land clearing",
  ],

  // ── Mechanical, gas & low-voltage ───────────────────────────────────────
  gasfitter: [
    "gasfitter", "gas fitter", "gas line", "gas leak", "gas smell", "propane",
    "natural gas", "gas stove hookup", "gas fireplace", "bbq line",
  ],
  refrigeration: [
    "refrigeration", "walk in cooler", "commercial fridge", "cold room",
    "ice machine", "commercial freezer",
  ],
  solar_installer: [
    "solar", "solar panel", "photovoltaic", "battery storage", "off grid",
  ],
  security_systems: [
    "alarm", "security camera", "cctv", "camera", "security system",
    "surveillance", "access control", "intercom", "doorbell camera",
  ],
  network_cabling: [
    "network cabling", "ethernet", "data cabling", "cat6", "cat5",
    "structured wiring", "server rack", "patch panel",
  ],
  home_automation: [
    "smart home", "home automation", "smart light", "smart thermostat",
    "smart switch", "smart blind", "alexa", "google home",
  ],
  av_installer: [
    "home theatre", "home theater", "projector", "surround sound", "speaker",
    "sound system", "av install", "media room", "tv wall mount",
  ],

  // ── Exterior & building envelope ────────────────────────────────────────
  siding: ["siding", "vinyl siding", "exterior cladding", "hardie", "board and batten"],
  gutters: [
    "gutter", "eavestrough", "eaves", "downspout", "gutter cleaning",
    "gutter guard", "gutter repair",
  ],
  window_installer: [
    "window installer", "new window", "replace window", "patio door",
    "sliding door", "exterior door", "entry door", "window replacement",
  ],
  glazier: [
    "glazier", "glass", "broken glass", "glass replacement", "window pane",
    "mirror", "shower glass", "glazing", "cracked glass",
  ],
  garage_door: [
    "garage door", "garage door opener", "garage spring", "overhead door",
  ],
  fencing: [
    "fencing", "fence", "new fence", "fence repair", "gate", "privacy fence",
    "chain link", "fence post",
  ],
  deck_builder: [
    "deck builder", "deck", "patio", "pergola", "gazebo", "deck repair",
    "porch", "build a deck",
  ],
  stucco: ["stucco", "exterior plaster", "parging", "eifs", "stucco repair"],
  waterproofing: [
    "waterproofing", "waterproof", "wet basement", "leaky basement",
    "basement flooding", "water in basement", "damp proofing", "french drain",
  ],
  insulation: [
    "insulation", "insulate", "attic insulation", "spray foam",
    "blown insulation", "drafty", "batt insulation", "soundproofing",
  ],

  // ── Interior & finishing ────────────────────────────────────────────────
  cabinetry: [
    "cabinetry", "cabinet", "millwork", "kitchen cabinet", "custom cabinet",
    "built in", "vanity", "closet organizer",
  ],
  countertop: [
    "countertop", "counter top", "counters", "granite", "quartz",
    "marble counter", "island top",
  ],
  wallpaper: ["wallpaper", "wall covering", "wall paper", "remove wallpaper", "mural"],
  window_treatments: [
    "blinds", "shades", "curtain", "drape", "window treatment", "shutters",
    "roller blind", "valance",
  ],

  // ── Outdoor & grounds ───────────────────────────────────────────────────
  arborist: [
    "arborist", "tree", "tree removal", "tree trimming", "tree cutting",
    "stump", "stump grinding", "prune", "dead tree", "branch", "limb",
  ],
  irrigation: [
    "irrigation", "sprinkler", "drip system", "lawn watering",
    "sprinkler repair", "backflow",
  ],
  hardscaping: [
    "hardscaping", "paver", "paving", "interlock", "retaining wall", "walkway",
    "stone patio",
  ],
  snow_removal: [
    "snow removal", "snow", "plowing", "plow", "snow clearing", "ice removal",
    "salting",
  ],
  pool_spa: [
    "pool", "hot tub", "swim spa", "swimming pool", "pool opening",
    "pool closing", "pool pump", "pool heater", "jacuzzi",
  ],
  septic: [
    "septic", "septic tank", "septic pump", "leach field", "septic backup",
    "holding tank",
  ],

  // ── Specialty services ──────────────────────────────────────────────────
  duct_cleaning: [
    "duct cleaning", "air duct", "vent cleaning", "dryer vent",
    "ductwork cleaning",
  ],
  pressure_washing: [
    "pressure wash", "power wash", "pressure washing", "driveway cleaning",
    "exterior wash",
  ],
  window_cleaning: [
    "window cleaning", "wash windows", "clean windows", "window washing",
    "squeegee",
  ],
  chimney_sweep: [
    "chimney", "chimney sweep", "chimney cleaning", "fireplace cleaning",
    "creosote", "flue",
  ],
  junk_removal: [
    "junk", "junk removal", "haul away", "hauling", "garbage removal", "debris",
    "clear out", "dump run", "rubbish",
  ],
  moving: [
    "moving", "movers", "relocation", "packing", "furniture moving",
    "move out", "move in", "moving help",
  ],
  home_inspection: [
    "home inspection", "home inspector", "inspect", "pre purchase inspection",
    "building inspection",
  ],
};

export interface TradeSuggestion extends TradeOption {
  /** Keywords from the query that drove this suggestion — for the "why" hint. */
  matched: string[];
  score: number;
}

// Wrap in single spaces and strip punctuation so we can do word-boundary
// prefix matching with a plain `includes`: " leak" matches " leaking" but
// " event" never matches " vent".
function normalize(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;
}

const TRADE_BY_KEY = new Map(TRADES.map((t) => [t.key, t]));

/**
 * Map a plain-English description to ranked trade suggestions. Returns [] for
 * trivially short input. Pure and synchronous — safe to call on every keystroke.
 */
export function suggestTrades(query: string, max = 4): TradeSuggestion[] {
  const q = normalize(query);
  if (q.trim().length < 3) return [];

  const scored: TradeSuggestion[] = [];
  for (const [key, keywords] of Object.entries(TRADE_KEYWORDS)) {
    const trade = TRADE_BY_KEY.get(key);
    if (!trade) continue; // guarded by the integrity test; skip defensively
    const matched: string[] = [];
    let score = 0;
    for (const kw of keywords) {
      // Leading boundary, no trailing — so "leak"→"leaking", "fence"→"fences".
      if (q.includes(` ${kw}`)) {
        matched.push(kw);
        score += kw.split(" ").length; // multi-word phrases are stronger signals
      }
    }
    if (score > 0) scored.push({ ...trade, matched, score });
  }

  // Rank: total score first, then the more SPECIFIC match (a distinctive
  // object word like "dishwasher" should beat a generic symptom like "drain"
  // they tie on), then how many keywords hit.
  const longest = (s: TradeSuggestion) =>
    s.matched.reduce((n, kw) => Math.max(n, kw.length), 0);
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        longest(b) - longest(a) ||
        b.matched.length - a.matched.length,
    )
    .slice(0, max);
}
