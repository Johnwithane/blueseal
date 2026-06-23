import { describe, it, expect } from "vitest";
import { isValidSlug, slugError, suggestSlug, SLUG_MAX } from "./slug";

describe("isValidSlug", () => {
  it("accepts lowercase hyphenated handles", () => {
    expect(isValidSlug("bellweather-plumbing")).toBe(true);
    expect(isValidSlug("abc")).toBe(true);
    expect(isValidSlug("a1b2")).toBe(true);
  });

  it("rejects bad shapes", () => {
    expect(isValidSlug("ab")).toBe(false); // too short
    expect(isValidSlug("x".repeat(SLUG_MAX + 1))).toBe(false); // too long
    expect(isValidSlug("-lead")).toBe(false);
    expect(isValidSlug("trail-")).toBe(false);
    expect(isValidSlug("double--hyphen")).toBe(false);
    expect(isValidSlug("Caps")).toBe(false);
    expect(isValidSlug("has space")).toBe(false);
    expect(isValidSlug("emoji😀")).toBe(false);
  });

  it("rejects reserved handles", () => {
    expect(isValidSlug("admin")).toBe(false);
    expect(isValidSlug("tradies")).toBe(false);
    expect(isValidSlug("blue-seal")).toBe(false);
  });
});

describe("slugError", () => {
  it("returns null for a valid handle and a message otherwise", () => {
    expect(slugError("good-handle")).toBeNull();
    expect(slugError("")).toMatch(/choose/i);
    expect(slugError("ab")).toMatch(/at least/i);
    expect(slugError("Bad Caps")).toMatch(/lowercase/i);
    expect(slugError("admin")).toMatch(/reserved/i);
  });
});

describe("suggestSlug", () => {
  it("slugifies a company name", () => {
    expect(suggestSlug("Bellweather Plumbing & Heating")).toBe("bellweather-plumbing-heating");
    expect(suggestSlug("  Joe's   Sparks!! ")).toBe("joe-s-sparks");
    expect(suggestSlug("ACME Ltd.")).toBe("acme-ltd");
  });

  it("never leaves leading/trailing or doubled hyphens", () => {
    const s = suggestSlug("--- weird __ name ---");
    expect(s.startsWith("-")).toBe(false);
    expect(s.endsWith("-")).toBe(false);
    expect(s.includes("--")).toBe(false);
  });
});
