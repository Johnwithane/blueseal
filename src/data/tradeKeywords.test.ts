import { describe, it, expect } from "vitest";
import { TRADES } from "@/data/trades";
import { TRADE_KEYWORDS, suggestTrades } from "@/data/tradeKeywords";

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
});
