import { describe, expect, it } from "vitest";
import { isTradieInsured } from "./insuranceStatus";

// Fixed reference point so tests aren't clock-dependent.
const NOW = new Date("2025-06-01T00:00:00Z").getTime();

// Helpers — construct Timestamp-like objects without importing firebase/firestore.
const futureMs = NOW + 86_400_000; // +1 day
const pastMs = NOW - 86_400_000; // -1 day

function tsLike(ms: number): { toMillis: () => number } {
  return { toMillis: () => ms };
}

describe("isTradieInsured — verified + future expiry → true", () => {
  it("returns true when verified and expiry is a future Timestamp-like", () => {
    expect(
      isTradieInsured(
        { insuranceVerified: true, insuranceExpiresAt: tsLike(futureMs) as never },
        NOW,
      ),
    ).toBe(true);
  });

  it("returns true when verified and expiry is a future Date", () => {
    expect(
      isTradieInsured(
        { insuranceVerified: true, insuranceExpiresAt: new Date(futureMs) },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("isTradieInsured — verified + past expiry → false", () => {
  it("returns false when verified but expiry is a past Timestamp-like", () => {
    expect(
      isTradieInsured(
        { insuranceVerified: true, insuranceExpiresAt: tsLike(pastMs) as never },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false when verified but expiry is a past Date", () => {
    expect(
      isTradieInsured(
        { insuranceVerified: true, insuranceExpiresAt: new Date(pastMs) },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false when expiry equals now exactly (not strictly future)", () => {
    expect(
      isTradieInsured(
        { insuranceVerified: true, insuranceExpiresAt: new Date(NOW) },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("isTradieInsured — verified + null/undefined expiry → false (fails closed)", () => {
  it("returns false when verified but insuranceExpiresAt is null", () => {
    expect(
      isTradieInsured({ insuranceVerified: true, insuranceExpiresAt: null }, NOW),
    ).toBe(false);
  });

  it("returns false when verified but insuranceExpiresAt is undefined", () => {
    expect(
      isTradieInsured({ insuranceVerified: true, insuranceExpiresAt: undefined }, NOW),
    ).toBe(false);
  });

  it("returns false when verified but insuranceExpiresAt is missing from the object", () => {
    expect(isTradieInsured({ insuranceVerified: true }, NOW)).toBe(false);
  });
});

describe("isTradieInsured — insuranceVerified is not true → false", () => {
  it("returns false when insuranceVerified is false", () => {
    expect(
      isTradieInsured(
        { insuranceVerified: false, insuranceExpiresAt: new Date(futureMs) },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false when insuranceVerified is undefined", () => {
    expect(
      isTradieInsured(
        { insuranceVerified: undefined, insuranceExpiresAt: new Date(futureMs) },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false when insuranceVerified is null", () => {
    expect(
      isTradieInsured(
        { insuranceVerified: null as never, insuranceExpiresAt: new Date(futureMs) },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("isTradieInsured — null/undefined input → false", () => {
  it("returns false when the entire fields object is null", () => {
    expect(isTradieInsured(null, NOW)).toBe(false);
  });

  it("returns false when the entire fields object is undefined", () => {
    expect(isTradieInsured(undefined, NOW)).toBe(false);
  });
});

describe("isTradieInsured — injected now arg is respected", () => {
  it("returns true when `now` is in the past relative to the expiry", () => {
    const expiry = new Date("2024-01-01T00:00:00Z");
    const earlier = new Date("2023-12-31T00:00:00Z").getTime();
    // `now` is before the expiry → still insured at that moment
    expect(
      isTradieInsured({ insuranceVerified: true, insuranceExpiresAt: expiry }, earlier),
    ).toBe(true);
  });

  it("returns false when `now` is past the expiry even if the Date is in the future by wall-clock", () => {
    const expiry = new Date(futureMs);
    const farFuture = futureMs + 86_400_000 * 365; // a year after the expiry
    expect(
      isTradieInsured({ insuranceVerified: true, insuranceExpiresAt: expiry }, farFuture),
    ).toBe(false);
  });
});
