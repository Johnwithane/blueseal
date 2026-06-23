import { describe, it, expect } from "vitest";
import { normalizeServices, SERVICES_MAX, SERVICE_NAME_MAX } from "./services";

describe("normalizeServices", () => {
  it("trims, collapses whitespace, and drops empties", () => {
    expect(normalizeServices(["  Boiler   install  ", "", "   ", "Leak repair"])).toEqual([
      "Boiler install",
      "Leak repair",
    ]);
  });

  it("de-duplicates case-insensitively, keeping first-seen casing", () => {
    expect(normalizeServices(["Boiler Install", "boiler install", "BOILER INSTALL"])).toEqual([
      "Boiler Install",
    ]);
  });

  it("preserves input order", () => {
    expect(normalizeServices(["C", "A", "B"])).toEqual(["C", "A", "B"]);
  });

  it("caps each name to SERVICE_NAME_MAX characters", () => {
    const long = "x".repeat(SERVICE_NAME_MAX + 25);
    const [only] = normalizeServices([long]);
    expect(only).toHaveLength(SERVICE_NAME_MAX);
  });

  it("caps the list to SERVICES_MAX entries", () => {
    const many = Array.from({ length: SERVICES_MAX + 10 }, (_, i) => `service ${i}`);
    expect(normalizeServices(many)).toHaveLength(SERVICES_MAX);
  });

  it("ignores non-string entries and non-array input", () => {
    expect(normalizeServices(["ok", 42, null, undefined, {}] as unknown[])).toEqual(["ok"]);
    expect(normalizeServices(undefined)).toEqual([]);
    expect(normalizeServices(null)).toEqual([]);
    expect(normalizeServices("nope")).toEqual([]);
  });
});
