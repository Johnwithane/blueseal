import { describe, it, expect } from "vitest";
import { SUPPLIES_CATALOG, catalogForTrade } from "./suppliesCatalog";
import { TRADES } from "./trades";
import { SUPPLY_PARTNERS } from "./supplyPartners";

const tradeKeys = new Set(TRADES.map((t) => t.key));
const partnerIds = new Set(SUPPLY_PARTNERS.map((p) => p.id));

describe("SUPPLIES_CATALOG", () => {
  it("only keys real trades", () => {
    const orphans = Object.keys(SUPPLIES_CATALOG).filter((k) => !tradeKeys.has(k));
    expect(orphans).toEqual([]);
  });

  it.each(Object.entries(SUPPLIES_CATALOG))("%s: items are well-formed", (_trade, items) => {
    expect(items.length).toBeGreaterThan(0);
    // Queries unique within a trade (no duplicate quick-picks).
    const queries = items.map((i) => i.query);
    expect(new Set(queries).size).toBe(queries.length);

    for (const item of items) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.group.trim().length).toBeGreaterThan(0);
      expect(item.query.trim().length).toBeGreaterThan(0);
      if (item.defaultPartnerId) expect(partnerIds.has(item.defaultPartnerId)).toBe(true);
    }
  });
});

describe("catalogForTrade", () => {
  it("returns the seeded list for a known trade", () => {
    expect(catalogForTrade("plumber")).toBe(SUPPLIES_CATALOG.plumber);
  });

  it("returns an empty array for an unseeded trade", () => {
    expect(catalogForTrade("locksmith")).toEqual([]);
    expect(catalogForTrade("not_a_trade")).toEqual([]);
  });
});
