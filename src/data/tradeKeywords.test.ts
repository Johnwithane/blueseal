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
});
