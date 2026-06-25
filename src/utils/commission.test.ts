import { describe, it, expect } from "vitest";
import { commissionCents, COMMISSION_RATE_BPS } from "./commission";

describe("commissionCents", () => {
  it("is 10% by default", () => {
    expect(COMMISSION_RATE_BPS).toBe(1000);
    // $29.00 Pro subscription -> $2.90
    expect(commissionCents(2900)).toBe(290);
    // $290.00 annual -> $29.00
    expect(commissionCents(29000)).toBe(2900);
  });

  it("rounds to the nearest cent", () => {
    // 10% of 2999 = 299.9 -> 300
    expect(commissionCents(2999)).toBe(300);
    // 10% of 1234 = 123.4 -> 123
    expect(commissionCents(1234)).toBe(123);
  });

  it("honours a custom rate", () => {
    expect(commissionCents(10000, 1500)).toBe(1500); // 15%
  });

  it("is 0 for non-positive or invalid gross", () => {
    expect(commissionCents(0)).toBe(0);
    expect(commissionCents(-500)).toBe(0);
    expect(commissionCents(Number.NaN)).toBe(0);
  });
});
