import { describe, it, expect } from "vitest";
import { geohashForLocation } from "geofire-common";
import { decodeGeohashCenter } from "./geohash";

// A length-6 geohash cell is ~1.2km x 0.6km, so the decoded center must be
// within ~0.01 degrees (~1.1km) of the original point in the worst case.
const CELL_TOLERANCE_DEG = 0.01;

describe("decodeGeohashCenter", () => {
  it("round-trips against geofire's encoder for Canadian cities", () => {
    const points = [
      { lat: 49.8880, lng: -119.4960 }, // Kelowna
      { lat: 43.6532, lng: -79.3832 }, // Toronto
      { lat: 45.5019, lng: -73.5674 }, // Montreal
      { lat: 53.5461, lng: -113.4938 }, // Edmonton
    ];
    for (const p of points) {
      const hash = geohashForLocation([p.lat, p.lng]).slice(0, 6);
      const center = decodeGeohashCenter(hash);
      expect(Math.abs(center.lat - p.lat)).toBeLessThan(CELL_TOLERANCE_DEG);
      expect(Math.abs(center.lng - p.lng)).toBeLessThan(CELL_TOLERANCE_DEG);
    }
  });

  it("decoded center re-encodes to the same cell", () => {
    const hash = geohashForLocation([49.888, -119.496]).slice(0, 6);
    const center = decodeGeohashCenter(hash);
    expect(geohashForLocation([center.lat, center.lng]).slice(0, 6)).toBe(hash);
  });

  it("throws on a non-base32 character", () => {
    expect(() => decodeGeohashCenter("abc!de")).toThrow();
  });
});
