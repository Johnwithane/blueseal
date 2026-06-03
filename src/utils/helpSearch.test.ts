import { describe, expect, it } from "vitest";
import { buildHelpIndex, highlight, searchHelp } from "./helpSearch";
import { HELP_CONTENT_SEED } from "@/data/help";
import { helpContentSchema } from "@/validation/schemas";

const index = buildHelpIndex(HELP_CONTENT_SEED.articles, HELP_CONTENT_SEED.faqs);

describe("searchHelp", () => {
  it("returns nothing for an empty query", () => {
    expect(searchHelp(index, "")).toEqual([]);
    expect(searchHelp(index, "   ")).toEqual([]);
  });

  it("ranks a strong title match first", () => {
    const results = searchHelp(index, "verification");
    expect(results.length).toBeGreaterThan(0);
    // The article about how verification works should top the list.
    expect(results[0].item.title.toLowerCase()).toContain("verif");
  });

  it("matches on keywords that aren't in the title", () => {
    // "pwa" only appears as a keyword on the install article.
    const results = searchHelp(index, "pwa");
    expect(results.some((r) => r.item.ref === "install-the-app")).toBe(true);
  });

  it("tolerates a single typo on longer terms", () => {
    const clean = searchHelp(index, "invoice");
    const typo = searchHelp(index, "invoise"); // s↔c swap
    expect(clean.length).toBeGreaterThan(0);
    expect(typo.length).toBeGreaterThan(0);
  });

  it("respects the result limit", () => {
    expect(searchHelp(index, "job", 3).length).toBeLessThanOrEqual(3);
  });

  it("includes FAQ entries in results", () => {
    const results = searchHelp(index, "free", 20);
    expect(results.some((r) => r.item.kind === "faq")).toBe(true);
  });
});

describe("highlight", () => {
  it("wraps matched spans and leaves the rest", () => {
    const segs = highlight("Finding a tradesperson", ["finding"]);
    const hit = segs.find((s) => s.hit);
    expect(hit?.text.toLowerCase()).toBe("finding");
    // Reassembling the segments reproduces the original text.
    expect(segs.map((s) => s.text).join("")).toBe("Finding a tradesperson");
  });

  it("returns a single unflagged segment when there are no terms", () => {
    expect(highlight("Anything", [])).toEqual([{ text: "Anything", hit: false }]);
  });
});

describe("HELP_CONTENT_SEED integrity", () => {
  it("passes the published-content schema (unique slugs, valid category refs)", () => {
    const result = helpContentSchema.safeParse(HELP_CONTENT_SEED);
    if (!result.success) {
      throw new Error(result.error.issues.map((i) => i.message).join("\n"));
    }
    expect(result.success).toBe(true);
  });
});
