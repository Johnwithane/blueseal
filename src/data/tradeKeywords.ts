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
// How matching works (see `suggestTrades` below):
//   • Long keywords (4+ chars) match at a WORD BOUNDARY as a PREFIX — so "leak"
//     also catches "leaking"/"leaks", and "fence" catches "fences". This gives
//     free stemming for the vast majority of terms.
//   • Short keywords (1-3 chars, e.g. "ac", "rat", "key", "tap") match the WHOLE
//     word only (plus a simple plural). Prefix-matching a 2-3 letter stem is a
//     false-positive machine — "ant" would hit "antenna", "key" would hit
//     "keyboard", "tap" would hit "tape". Whole-word matching keeps them safe,
//     so we can include the short colloquial terms people actually type.
//   • Multi-word keywords ("water heater", "new fence") must appear as a
//     contiguous phrase; they're stronger signals and score by word count, so a
//     specific trade out-ranks an incidental single-word hit.
//
// This is the entire matcher — deterministic, offline, zero-cost, and the only
// thing standing between a client's words and the right trade. There is no AI
// fallback: keep this lexicon broad and accurate. When you add a trade to
// trades.ts, add a keyword line here too — the integrity test in
// tradeKeywords.test.ts fails if a trade has no keywords or a keyword points at
// an unknown trade.
//
// Keep keywords lowercase, base form (singular, no -ing). Overlap across trades
// is fine and expected — that's how we surface 2-3 sensible suggestions.
// ---------------------------------------------------------------------------

export const TRADE_KEYWORDS: Record<string, string[]> = {
  // ── Core mechanical & common ────────────────────────────────────────────
  plumber: [
    "plumber", "plumbing", "plumbing leak", "sink", "kitchen sink",
    "bathroom sink", "tap", "faucet", "leaky faucet", "dripping tap", "toilet",
    "running toilet", "clogged toilet", "overflowing toilet", "toilet leak",
    "flush", "leak", "water leak", "drip", "drain", "clogged drain",
    "slow drain", "drain cleaning", "floor drain", "clog", "blocked",
    "blockage", "pipe", "burst pipe", "frozen pipe", "leaking pipe", "repipe",
    "water heater", "hot water tank", "tankless", "no hot water", "hot water",
    "no water", "water pressure", "low water pressure", "no pressure", "sewer",
    "sewer backup", "backed up", "sump pump", "shower", "showerhead",
    "bathtub", "tub", "garbage disposal", "basin", "valve", "shutoff valve",
    "hose bib", "spigot", "bidet", "urinal", "sewage", "gurgling", "p trap",
    "water line", "supply line", "water softener", "rusty water", "flooded",
    "flooding", "garburator", "kohler", "moen", "rinnai",
  ],
  electrician: [
    "electrician", "electrical", "electric", "power", "no power", "lost power",
    "power outage", "outlet", "dead outlet", "add outlet", "socket", "plug",
    "switch", "light", "lighting", "light fixture", "flicker", "breaker",
    "breaker box", "fuse", "tripping", "trip", "panel", "electrical panel",
    "subpanel", "panel upgrade", "wiring", "wire", "rewire", "spark", "shock",
    "gfci", "afci", "ceiling fan", "exhaust fan", "bathroom fan", "dimmer",
    "ev charger", "car charger", "pot light", "pot lights", "recessed lighting",
    "potlight", "chandelier", "sconce", "amp", "amperage", "200 amp",
    "service upgrade", "voltage", "knob and tube", "aluminum wiring",
    "generator", "transfer switch", "smoke detector", "buzzing",
    "burning smell", "short circuit", "junction box", "baseboard heater",
    "hydro", "no hydro",
  ],
  hvac: [
    "hvac", "furnace", "furnace repair", "furnace not working", "new furnace",
    "oil furnace", "air conditioner", "air conditioning", "air con", "ac",
    "ac unit", "ac repair", "ac install", "new ac", "central air", "heat",
    "heating", "heater", "heating system", "cooling system", "no heat",
    "heat not working", "not heating", "cooling", "not cooling", "thermostat",
    "heat pump", "boiler", "radiator", "blowing cold", "blowing hot",
    "not blowing cold", "condenser", "mini split", "ductless", "ductwork",
    "duct", "air handler", "fan motor", "capacitor", "refrigerant", "freon",
    "furnace filter", "humidifier", "dehumidifier", "too cold", "too hot",
    "cold", "cold air", "hot air", "freezing", "chilly", "warm", "stuffy",
    "no air", "vents", "pilot light", "radiant heat", "baseboard heat",
    "carbon monoxide", "emergency heat", "hrv", "erv", "lennox", "trane",
    "goodman", "rheem",
  ],
  carpenter: [
    "carpenter", "carpentry", "wood", "woodwork", "wood repair", "wood rot",
    "trim", "trim work", "wood trim", "baseboard", "door", "doors",
    "interior door", "door frame", "hang a door", "frame", "framing a wall",
    "shelf", "shelving", "custom shelving", "floating shelf", "bookcase",
    "stairs", "staircase", "squeaky stairs", "handrail", "joinery", "molding",
    "moulding", "crown molding", "mantel", "custom wood", "wainscoting",
    "built in shelf", "finish carpentry",
  ],
  painter: [
    "painter", "paint", "painting", "interior painting", "exterior painting",
    "repaint", "primer", "stain", "varnish", "wall paint", "interior paint",
    "exterior paint", "wall colour", "wall color", "colour change",
    "color change", "ceiling paint", "trim paint", "spray paint",
    "feature wall", "accent wall", "peeling paint", "touch up paint",
    "fresh coat", "cabinet painting", "whole house paint",
  ],
  roofer: [
    "roofer", "roof", "roofing", "shingle", "shingles", "shingle repair",
    "roof leak", "leaking roof", "attic leak", "flashing", "chimney flashing",
    "soffit", "fascia", "ridge cap", "drip edge", "re roof", "reroof",
    "roof repair", "roof replacement", "roof damage", "new roof", "metal roof",
    "flat roof", "cedar shake", "missing shingles", "ice dam", "roof vent",
    "skylight leak", "roof inspection", "hail damage",
  ],
  landscaper: [
    "landscaper", "landscaping", "lawn", "lawn mowing", "lawn care",
    "lawn maintenance", "new lawn", "grass", "grass cutting", "grass seed",
    "mow", "mowing", "yard", "yard work", "yard maintenance", "yard cleanup",
    "garden", "gardening", "garden bed", "sod", "mulch", "mulching",
    "planting", "shrub", "hedge", "hedges", "hedge trimming", "weeds",
    "weeding", "weed control", "flower bed", "topsoil", "aeration",
    "overseeding", "edging", "overgrown", "leaf removal", "spring cleanup",
    "fall cleanup",
  ],
  handyman: [
    "handyman", "odd job", "small job", "small repair", "minor repairs",
    "various jobs", "general maintenance", "home repair", "general repair",
    "tv mount", "mount", "hang", "hang shelf", "hang pictures",
    "picture hanging", "assemble", "assembly", "flat pack", "ikea",
    "furniture assembly", "grab bar", "towel bar", "curtain rod", "patch",
    "caulk", "caulking", "door knob", "doorknob", "fix drawer", "drawer",
    "replace handle", "weatherstrip", "around the house", "honey do",
    "to do list", "punch list", "fix it", "squeaky door", "sticky door",
    "sticking door", "handy man", "general handyman", "jack of all trades",
    "small projects", "quick fix", "minor fix", "fix things", "fix stuff",
    "fix things around the house", "bunch of small jobs", "list of jobs",
    "list of repairs", "baby proofing", "child proofing", "hang mirror",
    "mount shelf", "install shelves", "wall anchors", "wall mount",
  ],
  appliance_repair: [
    "appliance", "appliances", "appliance install", "dishwasher",
    "dishwasher not working", "dishwasher not draining", "washing machine",
    "washer", "washer leaking", "dryer", "dryer not heating",
    "dryer not drying", "dryer not spinning", "fridge", "fridge not working",
    "fridge not cooling", "fridge warm", "refrigerator", "freezer",
    "freezer not freezing", "oven", "oven not heating", "oven not working",
    "stove", "stove not working", "stovetop", "cooktop", "range", "range hood",
    "wall oven", "microwave", "ice maker", "stove element", "heating element",
    "broken appliance", "dryer vent", "whirlpool", "maytag", "frigidaire",
    "kitchenaid", "kenmore", "bosch",
  ],
  drywall: [
    "drywall", "drywall repair", "drywall crack", "drywall hole",
    "new drywall", "sheetrock", "plaster", "plastering", "gyprock",
    "hole in wall", "hole in the wall", "patch drywall", "wall crack",
    "ceiling crack", "crack in wall", "crack in ceiling", "sagging ceiling",
    "patch wall", "patch hole", "taping", "tape and mud", "mudding",
    "corner bead", "water damage ceiling", "water stained ceiling",
    "ceiling repair", "nail pops", "skim coat", "texture ceiling", "stipple",
    "stipple ceiling", "popcorn ceiling",
  ],
  flooring: [
    "flooring", "floor", "floors", "new floor", "floor install",
    "floor replacement", "floor repair", "hardwood", "wood floor",
    "refinish hardwood", "floor refinishing", "floor sanding", "laminate",
    "laminate floor", "vinyl plank", "vinyl floor", "lvp", "floating floor",
    "carpet", "new carpet", "carpet install", "carpet repair", "subfloor",
    "floor leveling", "refinish floor", "squeaky floor", "creaky floor",
    "floorboard", "engineered wood", "underlay", "transition strip",
    "scratched floor", "buckled floor",
  ],
  tiling: [
    "tiling", "tile", "tiles", "tile install", "new tile", "retile",
    "backsplash", "tile backsplash", "grout", "regrout", "grouting",
    "grout repair", "cracked grout", "shower tile", "tile shower",
    "bathroom tile", "floor tile", "wall tile", "mosaic", "subway tile",
    "ceramic tile", "porcelain tile", "tile repair", "cracked tile",
    "loose tile", "tile setter", "heated floor",
  ],
  locksmith: [
    "locksmith", "lock", "locks", "lock repair", "new lock", "lock change",
    "broken lock", "locked out", "lockout", "key", "key cutting", "copy key",
    "spare key", "master key", "deadbolt", "stuck deadbolt", "rekey",
    "change locks", "change the locks", "door lock", "door not locking",
    "broken key", "smart lock", "keypad lock", "stuck key", "jammed lock",
    "jammed door", "new keys", "car key", "key fob", "safe opening",
  ],
  pest_control: [
    "pest", "pests", "pest control", "pest inspection", "bug problem",
    "exterminate", "exterminator", "fumigation", "infestation", "mice",
    "mouse", "mouse problem", "mice problem", "rat", "rodent", "rodent control",
    "ant", "ants", "carpenter ant", "cockroach", "roach", "bug", "bugs",
    "termite", "wasp", "wasp nest", "hornet", "hornet nest", "bee",
    "yellow jacket", "bed bug", "bedbug", "raccoon", "squirrel", "wildlife",
    "spider", "flea", "silverfish", "mole", "skunk", "fruit fly", "moth",
    "beetle", "centipede", "earwig", "mosquito", "tick", "bats", "bat removal",
    "groundhog", "critter", "critters", "pigeon",
    // Generic "animal" phrasing — clients often describe the symptom by the
    // category ("there's an animal in my attic") rather than the species.
    "animal", "animals", "wild animal", "wildlife removal", "animal removal",
    "animal control", "nuisance wildlife", "vermin", "varmint", "possum",
    "opossum", "racoon", "chipmunk", "gopher", "vole", "nest", "bird nest",
    "birds nest", "droppings", "scratching in the wall",
    "scratching in the walls", "scratching in the attic", "noise in the attic",
    "noises in the attic", "something in the attic", "something in the walls",
  ],
  cleaning: [
    "cleaning", "cleaner", "cleaning service", "need a cleaner", "housekeeping",
    "maid", "maid service", "deep clean", "deep cleaning", "move out clean",
    "move in clean", "one time clean", "recurring clean", "tidy", "house clean",
    "house cleaning", "apartment cleaning", "condo cleaning", "spring clean",
    "post construction clean", "post reno clean", "construction cleanup",
    "airbnb clean", "office cleaning", "commercial cleaning", "janitorial",
  ],

  // ── Construction & structural ───────────────────────────────────────────
  general_contractor: [
    "general contractor", "general contracting", "contractor", "renovation",
    "renovate", "reno", "gut reno", "full renovation", "home renovation",
    "remodel", "remodelling", "addition", "home addition", "extension",
    "second storey", "basement finish", "finish basement", "basement apartment",
    "basement renovation", "kitchen remodel", "kitchen renovation",
    "kitchen reno", "bathroom remodel", "bathroom renovation", "bathroom reno",
    "main floor reno", "open concept", "in law suite", "permit", "build out",
    "whole home reno", "new build", "custom home",
  ],
  framer: [
    "framer", "framing", "framing crew", "stud", "studs", "stud wall",
    "steel stud", "wall framing", "structural framing", "frame a wall",
    "frame basement", "build a wall", "new walls", "partition wall",
    "load bearing", "roof truss", "floor joist", "joist",
  ],
  mason: [
    "mason", "bricklayer", "brick", "brick wall", "brickwork", "masonry",
    "mortar", "mortar repair", "repointing", "block wall", "concrete block",
    "cinder block", "stone", "stone wall", "stonework", "stonemason",
    "stone veneer", "tuckpointing", "chimney rebuild", "chimney repair",
    "leaning chimney", "masonry fireplace", "crumbling brick", "brick repair",
    "brick steps", "parge",
  ],
  concrete: [
    "concrete", "cement", "concrete driveway", "new driveway",
    "slab", "concrete slab", "sidewalk", "sidewalk repair", "footing",
    "concrete pour", "patio slab", "concrete patio", "concrete crack",
    "crack repair", "garage floor", "concrete floor", "concrete steps",
    "concrete repair", "resurfacing", "exposed aggregate", "rebar", "curb",
    "concrete pad", "parking pad", "stamped concrete", "uneven concrete",
    "sinking concrete", "mudjacking",
  ],
  foundation: [
    "foundation", "foundation repair", "settling", "house settling",
    "foundation crack", "cracked foundation", "basement crack",
    "basement wall crack", "structural crack", "slab crack", "bowing wall",
    "leaning wall", "underpinning", "crawl space", "sinking foundation",
    "heaving", "epoxy injection", "crack injection", "stabilize foundation",
    "helical pile", "pier", "piling", "shoring",
  ],
  welder: [
    "welder", "weld", "welding", "welding repair", "weld repair",
    "metal fabrication", "metal work", "metalwork", "fabricate", "railing",
    "railings", "metal railing", "iron railing", "aluminum railing",
    "balcony railing", "stair railing", "steel", "structural steel",
    "custom metal", "metal gate", "wrought iron", "ornamental iron",
  ],
  demolition: [
    "demolition", "demolish", "demo", "tear down", "knock down", "remove wall",
    "remove a wall", "take down wall", "tear out", "interior demo",
    "interior demolition", "gut", "gut job", "strip out", "strip to studs",
    "break up concrete", "concrete removal", "deck removal", "shed removal",
    "garage demolition",
  ],
  excavation: [
    "excavation", "excavate", "excavator", "mini excavator", "digging", "dig",
    "trench", "trenching", "grading", "regrade", "earthworks", "backfill",
    "fill dirt", "land clearing", "site prep", "dig out basement",
    "foundation dig", "lot grading", "drainage ditch", "culvert", "pond",
    "bobcat",
  ],

  // ── Mechanical, gas & low-voltage ───────────────────────────────────────
  gasfitter: [
    "gasfitter", "gas fitter", "gas fitting", "gas", "gas line", "gas piping",
    "gas pipe", "gas valve", "gas leak", "gas smell", "smell gas", "propane",
    "propane line", "propane tank", "natural gas", "gas appliance",
    "gas hookup", "gas stove", "gas stove hookup", "gas range", "gas dryer",
    "gas fireplace", "gas fire pit", "gas bbq", "gas barbecue", "bbq line",
    "gas dryer hookup", "gas furnace hookup", "gas meter",
  ],
  refrigeration: [
    "refrigeration", "refrigeration tech", "commercial refrigeration",
    "walk in cooler", "walk in freezer", "commercial fridge", "commercial cooler",
    "reach in cooler", "beverage cooler", "restaurant fridge", "cold room",
    "ice machine", "commercial freezer", "display cooler", "refrigerated case",
    "condensing unit", "refrigerant leak", "compressor",
  ],
  solar_installer: [
    "solar", "solar installer", "solar panel", "solar panels", "rooftop solar",
    "solar system", "solar install", "pv system", "photovoltaic",
    "solar inverter", "grid tie", "net metering", "battery storage",
    "solar battery", "home battery", "powerwall", "off grid", "go solar",
  ],
  security_systems: [
    "alarm", "alarm system", "alarm install", "monitored alarm",
    "burglar alarm", "fire alarm", "security", "security system",
    "security camera", "camera install", "cctv", "camera", "cameras",
    "smart camera", "driveway camera", "surveillance", "door sensor",
    "window sensor", "motion sensor", "motion detector", "access control",
    "keypad", "panic button", "intercom", "doorbell camera", "video doorbell",
    "low voltage",
  ],
  network_cabling: [
    "network cabling", "networking", "network install", "network drop",
    "ethernet", "data cabling", "data jack", "cabling", "cat6", "cat5", "coax",
    "coaxial", "tv outlet", "phone jack", "fibre", "structured wiring",
    "wifi", "weak wifi", "wifi dead zone", "wifi install", "mesh wifi",
    "internet", "no internet", "access point", "server rack", "patch panel",
    "hardwire internet", "low voltage wiring",
  ],
  home_automation: [
    "smart home", "smart home install", "home automation", "automation",
    "automate", "smart light", "smart lighting", "smart thermostat",
    "smart switch", "smart plug", "smart blind", "smart blinds", "smart sensors",
    "voice control", "connected home", "home assistant", "alexa", "google home",
    "smart lock install",
  ],
  av_installer: [
    "home theatre", "home theater", "projector", "projector screen",
    "movie room", "media room", "surround sound", "speaker", "speakers",
    "speaker install", "wire speakers", "in wall speakers", "outdoor speakers",
    "sound system", "home audio", "soundbar", "receiver", "subwoofer",
    "av install", "tv mounting", "tv wall mount", "wall mount tv", "mount tv",
    "mount my tv", "mount television", "hide tv wires",
  ],

  // ── Exterior & building envelope ────────────────────────────────────────
  siding: [
    "siding", "siding install", "siding repair", "siding replacement",
    "new siding", "siding panel", "vinyl siding", "aluminum siding",
    "wood siding", "fibre cement", "james hardie", "hardie board", "hardie",
    "exterior cladding", "cladding", "board and batten", "capping",
    "aluminum capping", "house wrap", "damaged siding",
  ],
  gutters: [
    "gutter", "gutters", "gutter install", "new gutters", "seamless gutter",
    "eavestrough", "eavestrough cleaning", "eavestrough repair", "eaves",
    "downspout", "downspouts", "gutter cleaning", "clean gutters",
    "gutter guard", "gutter screen", "leaf guard", "gutter repair",
    "gutter leak", "leaking gutter", "sagging gutter", "clogged gutter",
    "overflowing gutter",
  ],
  window_installer: [
    "window installer", "window", "windows", "new window", "new windows",
    "window install", "replace window", "replace windows", "window replacement",
    "vinyl window", "casement window", "double pane", "triple pane",
    "drafty window", "foggy window", "egress window", "door install",
    "door replacement", "new door", "back door", "garden door", "french door",
    "patio door", "sliding door", "exterior door", "entry door", "front door",
    "storm door", "screen door",
  ],
  glazier: [
    "glazier", "glass", "glass repair", "broken glass", "glass replacement",
    "replace glass", "window glass", "broken window", "cracked window",
    "window pane", "cracked glass", "foggy glass", "insulated glass",
    "tempered glass", "mirror", "mirror install", "shower glass", "glass shower",
    "shower door glass", "glass door", "glass railing", "glass table top",
    "glass cut", "storefront glass", "glazing",
  ],
  garage_door: [
    "garage door", "garage door opener", "garage opener", "garage door install",
    "new garage door", "garage door repair", "garage door spring",
    "garage spring", "broken spring", "garage door cable", "garage door track",
    "garage door panel", "garage door sensor", "off track", "overhead door",
    "noisy garage door", "garage remote", "garage door stuck",
  ],
  fencing: [
    "fencing", "fence", "fence builder", "fence installation", "fence install",
    "new fence", "fence repair", "repair fence", "replace fence", "gate",
    "fence gate", "driveway gate", "garden gate", "privacy fence", "wood fence",
    "vinyl fence", "metal fence", "aluminum fence", "chain link",
    "chain link fence", "fence post", "post hole", "fence panel", "leaning fence",
  ],
  deck_builder: [
    "deck builder", "deck", "deck building", "new deck", "build a deck",
    "deck repair", "deck resurfacing", "deck refinishing", "deck staining",
    "deck boards", "deck railing", "railing for deck", "rotting deck",
    "wobbly deck", "composite deck", "cedar deck", "pressure treated deck",
    "patio", "patio cover", "pergola", "gazebo", "porch", "front porch",
    "screened porch",
  ],
  stucco: [
    "stucco", "stucco install", "new stucco", "stucco repair", "stucco patch",
    "stucco crack", "cracked stucco", "stucco wall", "exterior stucco",
    "exterior plaster", "parging", "foundation parging", "eifs",
    "acrylic stucco", "render",
  ],
  waterproofing: [
    "waterproofing", "waterproof", "basement waterproofing",
    "foundation waterproofing", "interior waterproofing",
    "exterior waterproofing", "wet basement", "leaky basement",
    "flooded basement", "basement flooding", "water in basement",
    "damp basement", "musty basement", "damp proofing", "french drain",
    "weeping tile", "basement leak", "foundation leak", "leaking foundation",
    "damp crawl space", "window well leak",
  ],
  insulation: [
    "insulation", "insulation install", "insulate", "add insulation",
    "top up insulation", "attic insulation", "insulate attic",
    "basement insulation", "crawl space insulation", "wall insulation",
    "spray foam", "foam insulation", "blown insulation", "blown in insulation",
    "fibreglass insulation", "rockwool", "batt insulation", "drafty",
    "drafts", "drafty house", "air sealing", "soundproofing", "cold room",
    "energy audit", "vapour barrier",
  ],

  // ── Interior & finishing ────────────────────────────────────────────────
  cabinetry: [
    "cabinetry", "cabinet", "cabinets", "cabinet maker", "custom cabinet",
    "custom cabinets", "kitchen cabinet", "kitchen cabinets", "new cabinets",
    "cabinet install", "cabinet doors", "shaker cabinets", "soft close",
    "cabinet hardware", "refacing", "reface cabinets", "cabinet refacing",
    "millwork", "built in", "built ins", "wall unit", "entertainment unit",
    "vanity", "bathroom vanity", "closet organizer", "custom closet",
    "mudroom", "pantry",
  ],
  countertop: [
    "countertop", "countertops", "counter top", "counters", "new counters",
    "counter install", "counter replacement", "granite", "granite counter",
    "quartz", "quartz counter", "marble counter", "stone counter",
    "solid surface", "corian", "laminate counter", "butcher block",
    "kitchen counter", "kitchen island", "bathroom counter", "vanity top",
    "island top", "new countertop",
  ],
  wallpaper: [
    "wallpaper", "wallpaper install", "wallpapering", "hang wallpaper",
    "wall covering", "wall paper", "remove wallpaper", "strip wallpaper",
    "wallpaper removal", "wall mural", "mural", "grasscloth", "peel and stick",
    "accent wallpaper",
  ],
  window_treatments: [
    "blinds", "window blinds", "new blinds", "blind install", "roller blind",
    "vertical blinds", "faux wood blinds", "zebra blinds", "motorized blinds",
    "blackout blinds", "shades", "window shades", "roller shades",
    "roman shades", "cellular shades", "motorized shades", "curtain",
    "curtains", "blackout curtains", "drape", "drapes", "drapery",
    "curtain install", "window treatment", "shutters", "plantation shutters",
    "california shutters", "valance",
  ],

  // ── Outdoor & grounds ───────────────────────────────────────────────────
  arborist: [
    "arborist", "tree", "trees", "tree service", "tree removal", "remove tree",
    "cut down tree", "tree trimming", "tree cutting", "tree pruning",
    "tree disease", "stump", "tree stump", "stump grinding", "stump removal",
    "prune", "pruning", "deadwooding", "dead tree", "branch", "branches",
    "fallen branch", "limb", "fallen tree", "overhanging branch",
    "brush removal", "wood chipping", "arborist report",
  ],
  irrigation: [
    "irrigation", "irrigation system", "irrigation install", "irrigation repair",
    "sprinkler", "sprinklers", "sprinkler system", "sprinkler install",
    "sprinkler repair", "sprinkler head", "broken sprinkler", "lawn sprinklers",
    "drip system", "drip irrigation", "drip line", "lawn watering",
    "zone valve", "rain sensor", "backflow", "backflow test", "sprinkler blowout",
    "winterize sprinkler",
  ],
  hardscaping: [
    "hardscaping", "paver", "pavers", "paver patio", "paving", "asphalt",
    "asphalt paving", "asphalt driveway", "seal driveway", "interlock",
    "interlocking", "driveway pavers", "retaining wall", "garden wall",
    "armour stone", "walkway", "stone walkway", "stone patio", "brick patio",
    "patio install", "paving stones", "patio stones", "stone steps",
    "natural stone", "flagstone", "block wall patio",
  ],
  snow_removal: [
    "snow removal", "snow", "snow plowing", "snow plow", "plowing", "plow",
    "driveway plowing", "snow clearing", "snow blowing", "shovel snow",
    "sidewalk snow", "parking lot snow", "roof snow removal", "ice removal",
    "ice control", "de icing", "salting", "seasonal snow", "winter maintenance",
  ],
  pool_spa: [
    "pool", "pool service", "pool cleaning", "pool maintenance", "pool repair",
    "pool leak", "pool installation", "new pool", "above ground pool",
    "inground pool", "swimming pool", "salt water pool", "pool opening",
    "pool closing", "pool pump", "pool filter", "pool heater", "pool liner",
    "liner replacement", "pool chemicals", "green pool", "hot tub",
    "hot tub repair", "spa", "spa repair", "swim spa", "jacuzzi",
  ],
  septic: [
    "septic", "septic system", "septic tank", "septic pump", "septic pumping",
    "pump septic", "tank pump out", "septic install", "new septic",
    "leach field", "drain field", "field bed", "septic backup", "septic smell",
    "holding tank", "septic cleaning", "septic repair", "septic inspection",
  ],

  // ── Specialty services ──────────────────────────────────────────────────
  duct_cleaning: [
    "duct cleaning", "air duct", "air vents", "return vents", "vent cleaning",
    "clean air ducts", "dryer vent cleaning", "ductwork cleaning", "clean ducts",
    "duct sanitizing", "hvac cleaning", "dusty vents", "mould in ducts",
    "furnace cleaning",
  ],
  pressure_washing: [
    "pressure wash", "pressure washing", "power wash", "power washing",
    "soft wash", "house washing", "wash house", "wash siding", "exterior wash",
    "exterior cleaning", "driveway cleaning", "clean driveway",
    "concrete cleaning", "sidewalk cleaning", "deck cleaning", "patio cleaning",
    "fence cleaning", "graffiti removal",
  ],
  window_cleaning: [
    "window cleaning", "window washing", "window washer", "wash windows",
    "clean windows", "glass cleaning", "screen cleaning", "skylight cleaning",
    "squeegee", "exterior windows", "storefront windows", "high windows",
    "dirty windows",
  ],
  chimney_sweep: [
    "chimney", "chimney sweep", "chimney cleaning", "clean chimney",
    "chimney inspection", "chimney cap", "chimney liner", "fireplace cleaning",
    "smoky fireplace", "flue", "flue cleaning", "creosote", "wood stove cleaning",
  ],
  junk_removal: [
    "junk", "junk removal", "junk pickup", "junk haul", "haul away", "hauling",
    "get rid of junk", "garbage removal", "trash removal", "debris",
    "debris removal", "clear out", "cleanout", "garage cleanout",
    "basement cleanout", "estate cleanout", "dump run", "dump trip", "rubbish",
    "furniture removal", "old furniture removal", "mattress removal",
    "appliance disposal", "hoarding", "declutter", "bin rental",
  ],
  moving: [
    "moving", "movers", "moving company", "moving help", "relocation",
    "local move", "long distance move", "small move", "office move",
    "moving day", "two movers", "packing", "packing service", "loading",
    "unloading", "furniture moving", "move furniture", "appliance moving",
    "move out", "move in", "load truck", "heavy lifting", "piano moving",
  ],
  home_inspection: [
    "home inspection", "home inspector", "house inspection",
    "property inspection", "inspect", "inspection", "inspection report",
    "pre purchase inspection", "pre sale inspection", "pre listing inspection",
    "new home inspection", "building inspection", "foundation inspection",
    "thermal inspection", "wett inspection", "mould inspection",
  ],

  // ── Automotive & vehicle ──────────────────────────────────────────────────
  auto_service: [
    "automotive", "auto repair", "car repair", "auto mechanic", "mechanic",
    "car service", "vehicle repair", "brakes", "brake repair", "brake job",
    "engine", "check engine", "engine light", "transmission", "oil change",
    "tune up", "muffler", "exhaust", "alternator", "starter", "car wont start",
    "suspension", "cv axle", "wheel alignment", "no start", "stalling",
    "timing belt", "spark plugs", "coolant leak",
  ],
  auto_body: [
    "auto body", "body shop", "collision", "collision repair", "car accident",
    "auto collision", "dent", "dent repair", "car dent", "bodywork", "fender",
    "bumper repair", "panel beating", "frame straightening", "rust repair car",
    "hail damage car", "scratch repair car",
  ],
  auto_refinishing: [
    "auto refinishing", "automotive refinishing", "car painting", "auto paint",
    "automotive paint", "repaint car", "car respray", "respray", "clear coat",
    "auto body paint", "vehicle paint", "paint correction", "colour match car",
  ],
  truck_transport_mechanic: [
    "truck mechanic", "diesel mechanic", "diesel repair", "semi truck",
    "transport truck", "big rig", "tractor trailer", "truck repair",
    "fleet repair", "commercial truck", "truck and transport", "dpf",
    "diesel engine", "truck brakes", "air brakes",
  ],
  transport_trailer_tech: [
    "transport trailer", "trailer repair", "trailer technician", "trailer brakes",
    "reefer trailer", "trailer service", "semi trailer", "trailer axle",
    "trailer lights", "trailer wiring",
  ],
  heavy_duty_mechanic: [
    "heavy duty mechanic", "heavy equipment repair", "heavy duty",
    "equipment mechanic", "off road equipment", "heavy equipment technician",
    "construction equipment repair", "hydraulics", "heavy machinery repair",
    "excavator repair", "loader repair",
  ],
  ag_equipment_tech: [
    "agricultural equipment", "farm equipment", "tractor repair", "farm machinery",
    "combine", "tractor", "agricultural machinery", "farm equipment repair",
    "implement repair", "baler repair",
  ],
  motorcycle_tech: [
    "motorcycle", "motorbike", "motorcycle repair", "bike repair", "dirt bike",
    "atv", "atv repair", "quad", "scooter repair", "motorcycle service",
    "harley", "snowmobile repair",
  ],
  rv_tech: [
    "rv repair", "rv service", "motorhome", "camper", "camper repair",
    "travel trailer", "fifth wheel", "rv", "recreational vehicle",
    "rv plumbing", "rv electrical", "slide out repair",
  ],

  // ── Industrial, metal & machining ─────────────────────────────────────────
  millwright: [
    "millwright", "industrial mechanic", "conveyor", "plant maintenance",
    "pump repair", "gearbox", "bearing replacement", "shaft alignment",
    "industrial machinery", "preventive maintenance", "machine install",
    "vibration analysis",
  ],
  machinist: [
    "machinist", "machine shop", "cnc", "cnc machining", "lathe", "milling",
    "precision machining", "custom part", "metal part", "tooling",
    "manual machining", "prototype part",
  ],
  tool_and_die: [
    "tool and die", "die maker", "tooling", "stamping die", "injection mould",
    "mold maker", "jig", "fixture", "die repair", "press tool", "custom die",
  ],
  metal_fabricator: [
    "metal fabrication", "metal fabricator", "fabricate", "steel fabrication",
    "custom metal", "metal fitting", "plate work", "structural fabrication",
    "metal shop", "sheet steel", "fabrication shop",
  ],
  sheet_metal: [
    "sheet metal", "ductwork fabrication", "metal ducting", "custom ductwork",
    "flashing fabrication", "metal roofing panel", "hvac ductwork",
    "tin smith", "metal cladding fabrication", "spiral duct",
  ],
  boilermaker: [
    "boilermaker", "pressure vessel", "industrial boiler", "boiler fabrication",
    "tank fabrication", "boiler tube", "vessel repair", "steam plant",
    "industrial tank", "welded vessel",
  ],
  ironworker: [
    "ironworker", "iron worker", "rebar", "reinforcing steel", "steel erection",
    "steel beam", "beam install", "ornamental iron", "structural steel install",
    "metal decking", "steel structure", "girder",
  ],
  instrumentation_tech: [
    "instrumentation", "instrument technician", "control systems", "calibration",
    "scada", "process control", "plc programming", "industrial controls",
    "gauge calibration", "field instruments", "transmitter", "loop check",
  ],
  parts_technician: [
    "parts technician", "auto parts", "parts counter", "parts department",
    "oem parts", "spare parts", "parts lookup", "partsperson", "parts desk",
    "inventory parts",
  ],

  // ── Industrial mechanical, electrical & process ───────────────────────────
  industrial_electrician: [
    "industrial electrician", "plant electrician", "3 phase", "three phase",
    "motor control", "plc", "factory wiring", "industrial wiring",
    "control panel", "conduit", "cable tray", "vfd", "motor wiring",
    "switchgear",
  ],
  powerline_tech: [
    "powerline", "power line", "hydro pole", "utility pole", "overhead lines",
    "power line repair", "line technician", "transmission line",
    "downed power line", "hydro line", "lineman", "power restoration",
  ],
  steamfitter: [
    "steamfitter", "pipefitter", "pipe fitting", "process piping", "steam line",
    "mechanical piping", "industrial piping", "hydronic piping", "welded pipe",
    "boiler piping", "chilled water line", "pipe spool",
  ],
  sprinkler_fitter: [
    "fire sprinkler", "sprinkler fitter", "fire suppression",
    "fire suppression system", "standpipe", "fire protection", "deluge system",
    "fire sprinkler system", "sprinkler inspection fire", "backflow fire",
  ],
  oil_heat_tech: [
    "oil heat", "oil furnace", "oil heating", "heating oil", "oil burner",
    "oil tank", "oil boiler", "furnace oil", "oil fired furnace",
    "oil nozzle", "oil heat repair",
  ],

  // ── Construction & site operations ────────────────────────────────────────
  heavy_equipment_operator: [
    "heavy equipment operator", "excavator operator", "bulldozer", "dozer",
    "backhoe", "skid steer", "bobcat operator", "loader operator", "grader",
    "heavy machinery", "earthmoving operator", "tractor loader backhoe",
    "equipment operator",
  ],
  crane_operator: [
    "crane", "crane operator", "mobile crane", "tower crane", "crane rental",
    "crane lift", "hoisting", "rigging", "boom truck", "picker truck",
    "crane service", "lift plan",
  ],
  construction_labourer: [
    "construction labourer", "general labourer", "construction helper",
    "site labourer", "construction crew", "skilled labourer", "labour crew",
    "site prep labour", "concrete labourer", "general labour",
  ],
  lather: [
    "lather", "interior systems", "metal stud framing", "suspended ceiling",
    "acoustic ceiling", "drop ceiling", "ceiling grid", "t bar ceiling",
    "steel stud ceiling", "interior systems mechanic", "wall framing metal",
  ],

  // ── Personal & food services ──────────────────────────────────────────────
  baker: [
    "baker", "bakery", "bread", "pastry", "cake", "cakes", "custom cake",
    "wedding cake", "baking", "dessert", "cupcakes", "pastry chef",
  ],
  cook: [
    "cook", "chef", "private chef", "personal chef", "catering", "caterer",
    "meal prep", "line cook", "prep cook", "dinner party chef", "menu planning",
    "in home chef",
  ],
  hairstylist: [
    "hairstylist", "hair stylist", "haircut", "hairdresser", "hair", "barber",
    "hair colour", "highlights", "blowout", "updo", "mobile hairstylist",
    "balayage",
  ],
};

// ---------------------------------------------------------------------------
// Room / project areas → the cluster of trades they usually involve.
//
// A symptom names ONE trade ("leaking tap" → plumber). A room or project names
// SEVERAL: type "bathroom" and you might need a plumber, a tiler, a drywaller,
// a painter… This map lets a client who only knows the SPACE — not the trades —
// get a sensible spread to consider.
//
// Each list is ordered MOST-RELEVANT FIRST. These are applied ADDITIVELY in
// suggestTrades: specific keyword matches always rank first, then a matched
// area appends its remaining trades. So a room word never overrides real intent
// ("wasp nest under the deck" stays pest_control), it just fills in the cluster.
// ---------------------------------------------------------------------------
export const PROJECT_AREAS: Record<string, string[]> = {
  bathroom: [
    "plumber", "tiling", "drywall", "general_contractor", "painter",
    "glazier", "countertop", "cabinetry", "electrician", "flooring",
  ],
  ensuite: ["plumber", "tiling", "drywall", "general_contractor", "glazier", "painter"],
  "powder room": ["plumber", "tiling", "drywall", "painter", "countertop"],
  washroom: ["plumber", "tiling", "drywall", "painter"],
  kitchen: [
    "cabinetry", "countertop", "plumber", "electrician", "tiling",
    "appliance_repair", "general_contractor", "painter", "flooring",
  ],
  basement: [
    "waterproofing", "framer", "drywall", "general_contractor", "insulation",
    "electrician", "flooring", "painter",
  ],
  attic: ["insulation", "electrician", "roofer", "pest_control", "hvac"],
  laundry: ["plumber", "appliance_repair", "electrician", "gasfitter", "cabinetry"],
  bedroom: ["painter", "flooring", "carpenter", "electrician", "drywall"],
  "living room": ["painter", "flooring", "electrician", "drywall", "carpenter"],
  "dining room": ["painter", "flooring", "electrician", "drywall"],
  garage: ["garage_door", "concrete", "electrician", "flooring", "drywall"],
  deck: ["deck_builder", "carpenter", "painter"],
  patio: ["deck_builder", "hardscaping", "concrete"],
  driveway: ["concrete", "hardscaping", "pressure_washing", "excavation"],
  yard: ["landscaper", "fencing", "hardscaping", "arborist", "deck_builder"],
  backyard: ["landscaper", "deck_builder", "fencing", "hardscaping", "arborist"],
  exterior: ["siding", "painter", "roofer", "gutters", "pressure_washing"],
  mudroom: ["flooring", "tiling", "cabinetry", "carpenter", "painter"],
  "mud room": ["flooring", "tiling", "cabinetry", "carpenter", "painter"],
  sunroom: ["general_contractor", "window_installer", "flooring", "hvac", "painter"],
  crawlspace: ["waterproofing", "insulation", "pest_control", "plumber"],
  "crawl space": ["waterproofing", "insulation", "pest_control", "plumber"],
  "home office": ["electrician", "painter", "network_cabling", "carpenter"],
  nursery: ["painter", "flooring", "electrician", "carpenter"],
  closet: ["cabinetry", "carpenter", "painter"],
  "whole house": ["general_contractor", "painter", "flooring", "electrician"],
  "whole home": ["general_contractor", "painter", "flooring", "electrician"],
};

// ---------------------------------------------------------------------------
// Ambiguous symptom / object words → every trade that could be the answer.
//
// Some words name a problem several trades handle: a "leak" could be a plumber,
// a roofer, a gasfitter, an HVAC tech, or a waterproofer. The lexicon files
// these under whichever trade owns the *phrase* ("roof leak", "gas leak"), so a
// bare "leak" would otherwise surface only one. Like PROJECT_AREAS these are
// applied ADDITIVELY — a specific hit ("kitchen sink leaking" → plumber) still
// leads; this just widens the net when the word stands alone. Most-likely first.
// ---------------------------------------------------------------------------
export const SYMPTOM_CLUSTERS: Record<string, string[]> = {
  leak: ["plumber", "roofer", "gasfitter", "hvac", "waterproofing"],
  crack: ["drywall", "foundation", "concrete", "mason", "glazier"],
  vent: ["hvac", "duct_cleaning", "roofer"],
  mold: ["waterproofing", "drywall", "hvac", "home_inspection"],
  mould: ["waterproofing", "drywall", "hvac", "home_inspection"],
  draft: ["insulation", "window_installer", "hvac"],
  smell: ["gasfitter", "plumber", "septic", "pest_control", "hvac"],
  odour: ["gasfitter", "plumber", "septic", "pest_control"],
  odor: ["gasfitter", "plumber", "septic", "pest_control"],
  drainage: ["landscaper", "waterproofing", "excavation", "plumber"],
  flooded: ["waterproofing", "plumber", "junk_removal"],
  tv: ["av_installer", "handyman", "electrician"],
  television: ["av_installer", "handyman", "electrician"],
};

// ---------------------------------------------------------------------------
// Generalist "companions" — the two trades that handle a LITTLE of everything.
//
// A handyman covers small residential repairs and finishing; a general
// contractor covers bigger or multi-trade work. For a huge range of home jobs
// they're a sensible SECOND option even when the client's words point at one
// specific trade ("paint the hallway" → painter, but a handyman could too).
// suggestTrades appends them AFTER the specific match (never outranking it) and
// BEFORE the broad clusters, keyed on the SPECIFIC trade that matched.
//
// Keyed by allow-list ON PURPOSE: only home repair/finishing/renovation trades
// appear here. Licensed or specialised work (plumber, electrician, gas, HVAC,
// roofing, locksmith…) and everything non-residential (automotive, industrial,
// food/personal) are intentionally absent — a generalist is not a substitute
// for permitted or specialised work, and we never want to imply otherwise.
// ---------------------------------------------------------------------------
export const HANDYMAN_COMPANION_TRADES = new Set<string>([
  "carpenter", "painter", "drywall", "tiling", "flooring", "fencing",
  "deck_builder", "cabinetry", "countertop", "wallpaper", "window_treatments",
  "gutters", "siding", "garage_door", "window_installer",
]);
export const GC_COMPANION_TRADES = new Set<string>([
  "carpenter", "drywall", "tiling", "flooring", "framer", "concrete",
  "foundation", "mason", "demolition", "excavation", "siding",
  "window_installer", "insulation", "waterproofing", "cabinetry",
  "countertop", "deck_builder", "stucco",
]);

export interface TradeSuggestion extends TradeOption {
  /** Keywords from the query that drove this suggestion — for the "why" hint. */
  matched: string[];
  score: number;
}

// Wrap in single spaces and strip punctuation so we can do word-boundary
// matching with a plain `includes`: " leak" matches " leaking", and " ac "
// matches the whole word "ac" but never " account".
function normalize(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;
}

const TRADE_BY_KEY = new Map(TRADES.map((t) => [t.key, t]));

// Inflectional endings for "typed-stem" matching (see keywordHits): a typed
// word matches a LONGER keyword when the keyword is just that word + one of
// these. This is what lets a half-typed/short word find its fuller tag —
// "cool"→"cooling", "paint"→"painter" — WITHOUT a blind prefix match letting
// "over" reach "overflow" or "back" reach "backflow" (those endings aren't
// inflections, so they're rejected). Precision through a closed suffix set.
// Note: "er"/"ers" are deliberately EXCLUDED — they turn verbs into unrelated
// nouns ("wash"→"washer", "cool"→"cooler") and bleed across trades.
const STEM_SUFFIXES = ["s", "es", "ing", "ed", "ion", "ment", "al"];

// Does the query (raw `q`, space-padded both ends; plus its `tokens`) hit `kw`?
//   • Multi-word phrase  → contiguous match ("water heater" within the query).
//   • Short single word (≤3) → whole word only, +simple plural ("rat"→"rats").
//     Prefix-matching a tiny stem matches half the dictionary ("ant"→"antenna").
//   • Long single word (≥4):
//       – forward stem: the keyword is a prefix of a typed word, so the lexicon
//         can stay in base form ("leak"→"leaking", "fence"→"fences").
//       – typed stem: a typed word + an inflection equals the keyword, so a
//         shorter typed word still finds it ("cool"→"cooling"). Suffix-checked.
function keywordHits(q: string, tokens: string[], kw: string): boolean {
  if (kw.includes(" ")) return q.includes(` ${kw}`);
  if (kw.length <= 3) {
    return tokens.includes(kw) || tokens.includes(`${kw}s`) || tokens.includes(`${kw}es`);
  }
  if (q.includes(` ${kw}`)) return true;
  return tokens.some(
    (t) => t.length >= 3 && t.length < kw.length && STEM_SUFFIXES.some((suf) => t + suf === kw),
  );
}

// True when a and b are within ONE edit — insert, delete, substitute, or
// adjacent transposition (Damerau-Levenshtein ≤ 1). Cheap and early-exiting; it
// runs only on the typo fallback path, never on the exact hot path.
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;

  if (la === lb) {
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    // substitution: everything after the first mismatch matches
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    // adjacent transposition: swap the mismatched pair and the rest matches
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }

  // Length differs by one → a single insertion/deletion. Walk the shorter
  // against the longer, allowing exactly one skip in the longer.
  const short = la < lb ? a : b;
  const long = la < lb ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
    } else {
      if (skipped) return false;
      skipped = true;
      j++; // consume one extra char from the longer string
    }
  }
  return true;
}

// Distinctive single-word keywords (≥4 chars) → the trades that use them, for
// the typo/voice fallback. Short words are matched strictly elsewhere and are
// far too collision-prone to fuzz ("ant"↔"and"). Built once at module load.
const FUZZABLE_KEYWORDS: Array<{ kw: string; keys: string[] }> = (() => {
  const byKeyword = new Map<string, Set<string>>();
  for (const [key, keywords] of Object.entries(TRADE_KEYWORDS)) {
    for (const kw of keywords) {
      if (kw.includes(" ") || kw.length < 4) continue;
      (byKeyword.get(kw) ?? byKeyword.set(kw, new Set()).get(kw)!).add(key);
    }
  }
  return [...byKeyword].map(([kw, keys]) => ({ kw, keys: [...keys] }));
})();

/**
 * Map a plain-English description to ranked trade suggestions. Returns [] for
 * trivially short input. Pure and synchronous — safe to call on every keystroke.
 */
export function suggestTrades(query: string, max = 4): TradeSuggestion[] {
  const q = normalize(query);
  if (q.trim().length < 2) return []; // allow real 2-char queries: "tv", "ac"
  const tokens = q.trim().split(" ");

  const scored: TradeSuggestion[] = [];
  for (const [key, keywords] of Object.entries(TRADE_KEYWORDS)) {
    const trade = TRADE_BY_KEY.get(key);
    if (!trade) continue; // guarded by the integrity test; skip defensively
    const matched: string[] = [];
    let score = 0;
    for (const kw of keywords) {
      if (keywordHits(q, tokens, kw)) {
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
  const rank = (arr: TradeSuggestion[]) =>
    arr.sort(
      (a, b) =>
        b.score - a.score ||
        longest(b) - longest(a) ||
        b.matched.length - a.matched.length,
    );
  rank(scored);

  // Typo / voice fallback: ONLY when nothing matched exactly, try a one-edit
  // fuzzy pass on the longer tokens ("plumer"→plumber, "electrican"→
  // electrician, "tolet"→toilet). Gated on a total miss so the exact hot path
  // is untouched; scored at a slight discount so a real hit always outranks it.
  if (scored.length === 0) {
    const fuzzy = new Map<string, string[]>();
    for (const t of tokens) {
      if (t.length < 5) continue;
      for (const { kw, keys } of FUZZABLE_KEYWORDS) {
        if (Math.abs(kw.length - t.length) > 1 || !withinOneEdit(t, kw)) continue;
        for (const key of keys) {
          const arr = fuzzy.get(key) ?? fuzzy.set(key, []).get(key)!;
          if (!arr.includes(kw)) arr.push(kw);
        }
      }
    }
    for (const [key, kws] of fuzzy) {
      const trade = TRADE_BY_KEY.get(key);
      if (trade) scored.push({ ...trade, matched: kws, score: kws.length * 0.9 });
    }
    rank(scored);
  }

  // Generalist companions: when the client's words land on a SPECIFIC home
  // trade, also offer the handyman (small jobs) and/or general contractor
  // (bigger, multi-trade work) that could take it on. Eligibility is decided
  // HERE — from the specific matches only, never from cluster fillers below —
  // so "leak" (plumber, licensed) never pulls in a generalist, and "draft"
  // (a symptom-only expansion) doesn't either. The actual append happens AFTER
  // the clusters, so the genuinely-relevant room/symptom trades take the slots
  // first and the generalist only fills what's left over.
  const specificKeys = new Set(scored.map((s) => s.key));
  const wantHandyman =
    !specificKeys.has("handyman") &&
    [...specificKeys].some((k) => HANDYMAN_COMPANION_TRADES.has(k));
  const wantGc =
    !specificKeys.has("general_contractor") &&
    [...specificKeys].some((k) => GC_COMPANION_TRADES.has(k));

  // Cluster expansions, both ADDITIVE (appended after the keyword matches above,
  // most-relevant first, skipping anything already surfaced — so they widen the
  // net without ever reordering a specific hit):
  //   • SYMPTOM_CLUSTERS — an ambiguous word ("leak") → every trade it could be.
  //   • PROJECT_AREAS    — a named room ("bathroom") → its usual trades.
  const recovering = scored.length === 0; // still nothing → allow a fuzzy term hit
  const present = new Set(scored.map((s) => s.key));
  const appendCluster = (map: Record<string, string[]>) => {
    for (const [term, tradeList] of Object.entries(map)) {
      if (scored.length >= max) break;
      const hit =
        keywordHits(q, tokens, term) ||
        (recovering &&
          !term.includes(" ") &&
          tokens.some((t) => t.length >= 5 && withinOneEdit(t, term)));
      if (!hit) continue;
      for (const key of tradeList) {
        const trade = TRADE_BY_KEY.get(key);
        if (!trade || present.has(key)) continue;
        present.add(key);
        scored.push({ ...trade, matched: [term], score: 0 });
      }
    }
  };
  appendCluster(SYMPTOM_CLUSTERS); // symptoms first — closer to the actual problem
  appendCluster(PROJECT_AREAS); // then the room spread

  // Finally, the generalist companions (eligibility decided above, before the
  // clusters). They fill only the slots the specific + cluster trades didn't —
  // so a rich job (a whole room) keeps its real trades, while a simple one
  // ("repaint the hallway") still surfaces a handyman as a sensible alternative.
  const companions: Array<{ key: string; why: string }> = [];
  if (wantHandyman) companions.push({ key: "handyman", why: "small jobs" });
  if (wantGc) companions.push({ key: "general_contractor", why: "larger projects" });
  for (const { key, why } of companions) {
    if (scored.length >= max) break;
    if (present.has(key)) continue;
    const trade = TRADE_BY_KEY.get(key);
    if (!trade) continue;
    present.add(key);
    scored.push({ ...trade, matched: [why], score: 0 });
  }

  return scored.slice(0, max);
}
