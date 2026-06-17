import { describe, it, expect } from "vitest";
import {
  SUPPLY_PARTNERS,
  SUPPLY_CATEGORY_ORDER,
  buildSearchUrl,
  partnerLink,
  partnersForCategory,
  partnersForTrade,
  type SupplyCategory,
  type SupplyPartner,
} from "./supplyPartners";

const CATEGORIES = new Set<SupplyCategory>(SUPPLY_CATEGORY_ORDER);

describe("SUPPLY_PARTNERS registry", () => {
  it("has unique ids", () => {
    const ids = SUPPLY_PARTNERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every partner is well-formed", () => {
    for (const p of SUPPLY_PARTNERS) {
      expect(p.id).toMatch(/^[a-z0-9_]+$/);
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(p.blurb.trim().length).toBeGreaterThan(0);
      expect(CATEGORIES.has(p.category)).toBe(true);
      // Fallback URLs must be real https links so the panel works pre-affiliate.
      expect(p.url).toMatch(/^https:\/\//);
      if (p.searchUrlTemplate) expect(p.searchUrlTemplate).toContain("{q}");
      if (p.affiliate) expect(p.affiliate.param.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers all four categories", () => {
    for (const cat of SUPPLY_CATEGORY_ORDER) {
      expect(partnersForCategory(cat).length).toBeGreaterThan(0);
    }
  });

  it("includes Amazon.ca wired for Associates tag attribution", () => {
    const amazon = SUPPLY_PARTNERS.find((p) => p.id === "amazon_ca");
    expect(amazon).toBeDefined();
    expect(amazon?.affiliate?.param).toBe("tag");
  });
});

describe("partnersForTrade", () => {
  it("returns unfiltered partners for any trade (none declare a filter yet)", () => {
    expect(partnersForTrade("plumber").length).toBe(SUPPLY_PARTNERS.length);
    expect(partnersForTrade("not_a_trade").length).toBe(SUPPLY_PARTNERS.length);
  });
});

describe("buildSearchUrl", () => {
  const plain: SupplyPartner = {
    id: "x",
    name: "X",
    category: "materials",
    url: "https://x.test/",
    blurb: "b",
    icon: "pi pi-box",
    searchUrlTemplate: "https://x.test/s?k={q}",
  };

  it("deep-links and URL-encodes the query", () => {
    expect(buildSearchUrl(plain, '1/2" copper pipe')).toBe(
      "https://x.test/s?k=1%2F2%22%20copper%20pipe",
    );
  });

  it("falls back to the landing url when there's no template", () => {
    const noTemplate = { ...plain, searchUrlTemplate: undefined };
    expect(buildSearchUrl(noTemplate, "pipe")).toBe("https://x.test/");
  });

  it("appends the affiliate tag to searches when configured", () => {
    const tagged = { ...plain, affiliate: { param: "tag", id: "blueseal-20" } };
    expect(buildSearchUrl(tagged, "drill")).toBe("https://x.test/s?k=drill&tag=blueseal-20");
  });

  it("adds no tag when the affiliate id is empty (pre-sign-up)", () => {
    const empty = { ...plain, affiliate: { param: "tag", id: "" } };
    expect(buildSearchUrl(empty, "drill")).toBe("https://x.test/s?k=drill");
  });
});

describe("partnerLink", () => {
  const base: SupplyPartner = {
    id: "y",
    name: "Y",
    category: "materials",
    url: "https://y.test/",
    blurb: "b",
    icon: "pi pi-box",
  };

  it("returns the bare landing url with no affiliate config", () => {
    expect(partnerLink(base)).toBe("https://y.test/");
  });

  it("appends the affiliate tag to the tile link when configured", () => {
    const tagged = { ...base, affiliate: { param: "tag", id: "blueseal-20" } };
    expect(partnerLink(tagged)).toBe("https://y.test/?tag=blueseal-20");
  });
});
