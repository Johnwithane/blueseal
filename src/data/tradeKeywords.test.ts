import { describe, it, expect } from "vitest";
import { TRADES } from "@/data/trades";
import {
  TRADE_KEYWORDS,
  PROJECT_AREAS,
  SYMPTOM_CLUSTERS,
  suggestTrades,
} from "@/data/tradeKeywords";

describe("TRADE_KEYWORDS integrity", () => {
  const tradeKeys = new Set(TRADES.map((t) => t.key));

  it("every keyword set points at a real trade key", () => {
    for (const key of Object.keys(TRADE_KEYWORDS)) {
      expect(tradeKeys.has(key), `unknown trade key "${key}"`).toBe(true);
    }
  });

  it("every trade has at least one keyword", () => {
    for (const t of TRADES) {
      const kws = TRADE_KEYWORDS[t.key];
      expect(kws && kws.length > 0, `trade "${t.key}" has no keywords`).toBe(true);
    }
  });

  it("keywords are lowercase (matcher normalises queries to lowercase)", () => {
    for (const kws of Object.values(TRADE_KEYWORDS)) {
      for (const kw of kws) {
        expect(kw, `"${kw}" must be lowercase`).toBe(kw.toLowerCase());
      }
    }
  });

  it("keywords survive query normalisation (no apostrophes/hyphens — those can never match)", () => {
    // The matcher strips every non [a-z0-9 ] char from the QUERY, so a keyword
    // containing one (e.g. "re-roof", "won't heat") could never be hit. A
    // clean keyword must equal its own normalised form.
    const normalized = (s: string) =>
      s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    for (const kws of Object.values(TRADE_KEYWORDS)) {
      for (const kw of kws) {
        expect(normalized(kw), `"${kw}" has a char queries strip — it can never match`).toBe(kw);
      }
    }
  });
});

describe("suggestTrades", () => {
  function topKey(q: string): string | undefined {
    return suggestTrades(q)[0]?.key;
  }

  it("returns nothing for trivially short input", () => {
    expect(suggestTrades("")).toEqual([]);
    expect(suggestTrades("a")).toEqual([]);
    expect(suggestTrades("  ")).toEqual([]);
  });

  it("matches common plain-English problems to the right trade", () => {
    expect(topKey("my kitchen sink is leaking")).toBe("plumber");
    expect(topKey("the power keeps tripping")).toBe("electrician");
    expect(topKey("lights keep flickering")).toBe("electrician");
    expect(topKey("furnace is not heating")).toBe("hvac");
    expect(topKey("I need a new fence")).toBe("fencing");
    expect(topKey("shingles blew off my roof")).toBe("roofer");
    expect(topKey("toilet won't stop running")).toBe("plumber");
    expect(topKey("dishwasher won't drain")).toBe("appliance_repair");
    expect(topKey("there's a tree I need removed")).toBe("arborist");
    expect(topKey("garage door won't open")).toBe("garage_door");
  });

  it("handles plurals and -ing forms via prefix matching", () => {
    expect(topKey("the fences are falling over")).toBe("fencing");
    expect(topKey("water is leaking everywhere")).toBe("plumber");
  });

  it("surfaces both trades for a genuinely ambiguous problem", () => {
    // A "roof leak" could be a roofer OR a plumber — show both, don't guess.
    const keys = suggestTrades("my roof is leaking").map((s) => s.key);
    expect(keys).toContain("roofer");
    expect(keys).toContain("plumber");
  });

  it("ranks a two-word phrase above an incidental single-word hit", () => {
    // "tree removal" (2-word) outweighs landscaper's lone "garden"/"yard".
    expect(topKey("tree removal in my back yard")).toBe("arborist");
  });

  it("returns multiple sensible suggestions when ambiguous", () => {
    const keys = suggestTrades("renovate my kitchen").map((s) => s.key);
    expect(keys).toContain("general_contractor");
    expect(keys.length).toBeGreaterThan(0);
  });

  it("respects the max cap", () => {
    expect(suggestTrades("install", 2).length).toBeLessThanOrEqual(2);
  });

  it("surfaces the matched keywords for the why-hint", () => {
    const [top] = suggestTrades("my sink is leaking");
    expect(top.key).toBe("plumber");
    expect(top.matched.length).toBeGreaterThan(0);
  });

  it("matches short keywords as whole words only (no false positives)", () => {
    function keys(q: string): string[] {
      return suggestTrades(q).map((s) => s.key);
    }
    // "ant" must not fire on "antenna", "key" must not fire on "keyboard",
    // "gut" must not fire on "gutter", "tap" must not fire on "taping".
    expect(keys("installing a new antenna")).not.toContain("pest_control");
    expect(keys("my keyboard is broken")).not.toContain("locksmith");
    expect(keys("gut the basement to the studs")).not.toContain("gutters");
    expect(keys("taping the drywall seams")).not.toContain("plumber");
  });

  it("still matches short keywords on the whole word and its plural", () => {
    expect(topKey("there are rats in the attic")).toBe("pest_control");
    expect(topKey("my ac stopped working")).toBe("hvac");
    expect(topKey("lost my key, locked out")).toBe("locksmith");
  });

  it("covers expanded colloquial phrasing", () => {
    expect(topKey("my gutters are overflowing")).toBe("gutters");
    expect(topKey("the deck boards are rotting")).toBe("deck_builder");
    expect(topKey("stamped concrete driveway")).toBe("concrete");
    expect(topKey("rekey all the locks")).toBe("locksmith");
    expect(topKey("my furnace won't heat the house")).toBe("hvac");
  });

  it("matches the bare word 'heat' (and its forms) to HVAC", () => {
    // Regression: "heat" alone used to match nothing — only "heating" + phrases
    // existed, and the prefix matcher can't grow "heat" into "heating".
    expect(topKey("my heat isn't working well")).toBe("hvac");
    expect(topKey("no heat in the house")).toBe("hvac");
    expect(topKey("the heater stopped")).toBe("hvac");
  });

  it("matches climate-symptom words to HVAC", () => {
    expect(topKey("it's not very cold in my house")).toBe("hvac");
    expect(topKey("the house is freezing")).toBe("hvac");
    expect(topKey("upstairs is too warm")).toBe("hvac");
  });

  it("ranks a broad spread of real-world phrasings to the right trade", () => {
    const cases: Record<string, string> = {
      "outlet sparked and now no power": "electrician",
      "want quartz countertops in the kitchen": "countertop",
      "wasp nest under the deck": "pest_control",
      "haul away the old furniture": "junk_removal",
      "set up security cameras": "security_systems",
      "gas line for a new bbq": "gasfitter",
      "sprinklers won't turn on": "irrigation",
      "snow on my driveway": "snow_removal",
      "need my driveway paved in asphalt": "hardscaping",
      "the pool is green": "pool_spa",
      "septic tank smells": "septic",
      "garage door is off track": "garage_door",
      "insulate my attic": "insulation",
      "waterproof the basement": "waterproofing",
      "foundation has a big crack": "foundation",
      "refinish the hardwood floors": "flooring",
      "regrout the shower": "tiling",
      "wifi doesn't reach upstairs": "network_cabling",
      "install blinds in the bedroom": "window_treatments",
      "solar panels on the roof": "solar_installer",
    };
    for (const [query, expected] of Object.entries(cases)) {
      expect(topKey(query), `"${query}"`).toBe(expected);
    }
  });

  it("matches a shorter typed word to its fuller tag (typed-stem)", () => {
    // The user types "cool"; the only tag is "cooling". Suffix-checked so it
    // resolves to HVAC.
    expect(topKey("cool")).toBe("hvac");
    expect(suggestTrades("the cool air quit").map((s) => s.key)).toContain("hvac");
    // ...but a common word that merely PREFIXES a tag must not bleed across:
    // "over" (in "fell over") must never reach plumber's "overflow".
    const keys = suggestTrades("the fence fell over").map((s) => s.key);
    expect(keys).toContain("fencing");
    expect(keys).not.toContain("plumber");
  });

  it("expands a named room/area into its cluster of trades", () => {
    function keys(q: string): string[] {
      return suggestTrades(q).map((s) => s.key);
    }
    // Naming only the SPACE surfaces the spread of trades it usually involves.
    const bathroom = keys("bathroom");
    expect(bathroom).toContain("plumber");
    expect(bathroom).toContain("tiling");

    const kitchen = keys("redo my kitchen");
    expect(kitchen).toContain("cabinetry");
    expect(kitchen).toContain("plumber");

    expect(keys("finish my basement")).toContain("waterproofing");
    expect(keys("garage needs work")).toContain("garage_door");
  });

  it("keeps a specific keyword hit ranked above the room cluster", () => {
    // "sink" pins plumber to the top even though "bathroom" pulls in a cluster.
    expect(topKey("my bathroom sink is leaking")).toBe("plumber");
    // The room word must never override clear intent located in that room.
    expect(topKey("wasp nest under the deck")).toBe("pest_control");
  });

  it("recovers from typos and voice-transcription slips (one-edit fuzzy)", () => {
    expect(topKey("plumer")).toBe("plumber"); // missing letter
    expect(topKey("electrican")).toBe("electrician"); // missing letter
    expect(topKey("furnance")).toBe("hvac"); // extra letter
    expect(topKey("dishwaser")).toBe("appliance_repair"); // missing letter
    // A misspelled ROOM still expands to its cluster.
    expect(suggestTrades("bathrom").map((s) => s.key)).toContain("plumber");
  });

  it("does not let the fuzzy fallback bleed", () => {
    // Gibberish stays empty — no edit-distance-1 neighbour, no false suggestion.
    expect(suggestTrades("qwerty zxcvbn")).toEqual([]);
    // The fallback only runs on a TOTAL miss, so exact hits are never perturbed.
    expect(topKey("my sink is leaking")).toBe("plumber");
    // Two edits away is too far — "planter" must not become "plumber".
    expect(suggestTrades("planter").map((s) => s.key)).not.toContain("plumber");
  });

  it("recognises common brand and Canadian regional terms", () => {
    expect(topKey("my whirlpool fridge died")).toBe("appliance_repair");
    expect(topKey("the garburator is jammed")).toBe("plumber");
    expect(topKey("no hydro to the garage")).toBe("electrician");
    expect(topKey("lennox furnace quit")).toBe("hvac");
  });

  it("expands the newer room areas", () => {
    expect(suggestTrades("redo the mudroom").map((s) => s.key)).toContain("tiling");
    expect(suggestTrades("damp crawlspace").map((s) => s.key)).toContain("waterproofing");
    expect(suggestTrades("wire my home office").map((s) => s.key)).toContain("network_cabling");
  });

  it("fans an ambiguous symptom out across every trade it could be", () => {
    // "leak" isn't only a plumber — surface roofer, gas, HVAC too.
    const leak = suggestTrades("leak").map((s) => s.key);
    expect(leak).toContain("plumber");
    expect(leak).toContain("roofer");
    expect(leak).toContain("gasfitter");
    // ...but a specific hit still leads when there's more signal.
    expect(topKey("my kitchen sink is leaking")).toBe("plumber");
    // "crack" spreads across the trades that patch them.
    const crack = suggestTrades("crack").map((s) => s.key);
    expect(crack).toContain("drywall");
    expect(crack).toContain("foundation");
  });

  it("maps tv / television to the AV installer", () => {
    expect(suggestTrades("tv").map((s) => s.key)).toContain("av_installer");
    expect(suggestTrades("television").map((s) => s.key)).toContain("av_installer");
    expect(suggestTrades("mount my tv on the wall").map((s) => s.key)).toContain("av_installer");
  });

  it("maps generic 'animal' / wildlife phrasing to pest control", () => {
    expect(topKey("there's an animal in my attic")).toBe("pest_control");
    expect(topKey("wild animal in the backyard")).toBe("pest_control");
    expect(topKey("scratching in the walls at night")).toBe("pest_control");
    expect(suggestTrades("something in the attic").map((s) => s.key)).toContain("pest_control");
  });

  it("offers a handyman alongside a small residential trade (never ahead of it)", () => {
    const paint = suggestTrades("repaint the hallway");
    expect(paint[0]?.key).toBe("painter"); // specific match still leads
    expect(paint.map((s) => s.key)).toContain("handyman");
    expect(paint.map((s) => s.key)).not.toContain("general_contractor"); // painting isn't a GC job
  });

  it("offers a general contractor alongside a structural/multi-trade trade", () => {
    const concrete = suggestTrades("pour a concrete slab");
    expect(concrete[0]?.key).toBe("concrete");
    expect(concrete.map((s) => s.key)).toContain("general_contractor");
    expect(concrete.map((s) => s.key)).not.toContain("handyman"); // concrete isn't a handyman job
  });

  it("expands a renovation / build into a broad crew of trades", () => {
    function keys(q: string): string[] {
      return suggestTrades(q, 6).map((s) => s.key);
    }
    // "renovation" used to surface only the general contractor — now it widens.
    const reno = suggestTrades("renovation", 6);
    expect(reno[0]?.key).toBe("general_contractor"); // the specific match still leads
    expect(reno.length).toBeGreaterThanOrEqual(4);
    expect(reno.map((s) => s.key)).toContain("carpenter");
    expect(reno.map((s) => s.key)).toContain("electrician");

    // Inflections + colloquial forms all widen the same way.
    expect(keys("renovating my house")).toContain("general_contractor");
    expect(keys("kitchen remodel")).toContain("cabinetry");
    expect(keys("planning a home addition")).toContain("framer");

    // "building a new house" must lead with the GC + crew — not pest_control
    // via the "house" → "mouse" one-edit fuzzy slip (regression).
    const build = suggestTrades("building a new house", 6);
    expect(build[0]?.key).toBe("general_contractor");
    expect(build.map((s) => s.key)).toContain("framer");
    expect(build.map((s) => s.key)).not.toContain("pest_control");
  });

  it("does not let 'home addition' bleed onto 'additional' wording", () => {
    // Bare "addition" would prefix-match "additional outlet" — we use the
    // multi-word term so an electrical job stays an electrical job.
    const keys = suggestTrades("add an additional outlet").map((s) => s.key);
    expect(keys).toContain("electrician");
    expect(keys).not.toContain("framer");
    expect(keys).not.toContain("foundation");
  });

  it("never offers a generalist for licensed / specialised trades", () => {
    // A generalist must never read as a substitute for permitted work.
    const outlet = suggestTrades("my outlet is dead").map((s) => s.key);
    expect(outlet).toContain("electrician");
    expect(outlet).not.toContain("handyman");
    expect(outlet).not.toContain("general_contractor");

    const tap = suggestTrades("fix the leaky faucet").map((s) => s.key);
    expect(tap).toContain("plumber");
    expect(tap).not.toContain("handyman");
    expect(tap).not.toContain("general_contractor");
  });
});

describe("SYMPTOM_CLUSTERS integrity", () => {
  const tradeKeys = new Set(TRADES.map((t) => t.key));

  it("every cluster points at real trade keys", () => {
    for (const [term, keys] of Object.entries(SYMPTOM_CLUSTERS)) {
      for (const key of keys) {
        expect(tradeKeys.has(key), `"${term}" → unknown trade "${key}"`).toBe(true);
      }
    }
  });

  it("terms are lowercase and survive query normalisation", () => {
    const normalized = (s: string) =>
      s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    for (const term of Object.keys(SYMPTOM_CLUSTERS)) {
      expect(term, `"${term}" must be lowercase`).toBe(term.toLowerCase());
      expect(normalized(term), `"${term}" has a char queries strip`).toBe(term);
    }
  });
});

describe("PROJECT_AREAS integrity", () => {
  const tradeKeys = new Set(TRADES.map((t) => t.key));

  it("every cluster points at real trade keys", () => {
    for (const [area, keys] of Object.entries(PROJECT_AREAS)) {
      for (const key of keys) {
        expect(tradeKeys.has(key), `area "${area}" → unknown trade "${key}"`).toBe(true);
      }
    }
  });

  it("area terms are lowercase and survive query normalisation", () => {
    const normalized = (s: string) =>
      s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    for (const area of Object.keys(PROJECT_AREAS)) {
      expect(area, `"${area}" must be lowercase`).toBe(area.toLowerCase());
      expect(normalized(area), `"${area}" has a char queries strip`).toBe(area);
    }
  });
});
