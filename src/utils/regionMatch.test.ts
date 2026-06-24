import { describe, it, expect } from "vitest";
import { matchRegionId, normalizePostal, findDuplicatePrefixes } from "./regionMatch";

const regions = [
  { id: "north", fsaPrefixes: ["V8", "V9"] },
  { id: "interior", fsaPrefixes: ["V8W"] }, // more specific than north's "V8"
];

describe("normalizePostal", () => {
  it("uppercases and strips spaces/punctuation", () => {
    expect(normalizePostal("v8w 1a1")).toBe("V8W1A1");
  });
});

describe("matchRegionId", () => {
  it("matches a postal code to its region by FSA prefix", () => {
    expect(matchRegionId("V9A 7N2", regions)).toBe("north");
  });
  it("prefers the longest (most specific) matching prefix", () => {
    expect(matchRegionId("V8W 1A1", regions)).toBe("interior");
  });
  it("returns null when nothing matches", () => {
    expect(matchRegionId("M5V 2T6", regions)).toBeNull();
  });
  it("returns null for empty input", () => {
    expect(matchRegionId("", regions)).toBeNull();
  });
});

describe("findDuplicatePrefixes", () => {
  it("flags a prefix claimed by two regions", () => {
    const dupes = findDuplicatePrefixes([
      { id: "a", fsaPrefixes: ["V8", "V9"] },
      { id: "b", fsaPrefixes: ["v9"] }, // case-insensitive dup of V9
    ]);
    expect(dupes).toEqual(["V9"]);
  });
  it("returns empty when prefixes are distinct", () => {
    expect(findDuplicatePrefixes(regions)).toEqual([]);
  });
});
