// Blue Seal service-fee math. Pins the worked examples from MONETIZATION.md
// and the structural invariants that make the model correct:
//   1. the tradesperson always nets the full base (chargeTotal − totalFee).
//   2. the platform nets ~platformPortion after Stripe takes its cut from the
//      whole charge (the gross-up identity, ±1¢ in the platform's favour).
//   3. floor first, cap last — an exhausted cap yields 0, never the $2 floor.
//
// This file is the canonical test for BOTH copies of computeServiceFee
// (src/utils ↔ functions/src/payments) — vitest excludes functions/**, so the
// client mirror is what's exercised; keep the two implementations identical.

import { describe, expect, it } from "vitest";
import {
  computeServiceFee,
  SERVICE_FEE_CAP_CENTS,
  STRIPE_FIXED_CENTS,
  STRIPE_RATE,
} from "./serviceFee";

describe("computeServiceFee — platform portion (5%, $2 floor, $99 cap)", () => {
  it("$150 invoice → $7.50 platform portion", () => {
    const q = computeServiceFee({ baseAmountCents: 15_000, waived: false });
    expect(q.platformPortionCents).toBe(750);
    expect(q.capApplied).toBe(false);
    expect(q.floorApplied).toBe(false);
  });

  it("$1,000 invoice → $50 platform portion", () => {
    const q = computeServiceFee({ baseAmountCents: 100_000, waived: false });
    expect(q.platformPortionCents).toBe(5_000);
  });

  it("$30 invoice → lifted to the $2 floor", () => {
    const q = computeServiceFee({ baseAmountCents: 3_000, waived: false });
    expect(q.platformPortionCents).toBe(200);
    expect(q.floorApplied).toBe(true);
    expect(q.capApplied).toBe(false);
  });

  it("the cap binds just above $1,980 (5% = $99)", () => {
    const atCap = computeServiceFee({ baseAmountCents: 198_000, waived: false });
    expect(atCap.platformPortionCents).toBe(SERVICE_FEE_CAP_CENTS);
    expect(atCap.capApplied).toBe(false); // 5% lands exactly on the cap

    const overCap = computeServiceFee({ baseAmountCents: 200_000, waived: false });
    expect(overCap.platformPortionCents).toBe(SERVICE_FEE_CAP_CENTS);
    expect(overCap.capApplied).toBe(true);
  });

  it("$10,000 invoice → still capped at $99", () => {
    const q = computeServiceFee({ baseAmountCents: 1_000_000, waived: false });
    expect(q.platformPortionCents).toBe(SERVICE_FEE_CAP_CENTS);
    expect(q.capApplied).toBe(true);
  });
});

describe("computeServiceFee — per-job cap accounting", () => {
  it("an upfront payment that used $50 of the cap leaves $49 for the final invoice", () => {
    // capUsed 5000 → capRemaining 4900; a $1,000 final invoice wants $50 but
    // only $49 of cap is left.
    const q = computeServiceFee({
      baseAmountCents: 100_000,
      waived: false,
      capUsedCents: 5_000,
    });
    expect(q.platformPortionCents).toBe(4_900);
    expect(q.capApplied).toBe(true);
  });

  it("an exhausted cap yields a $0 platform portion (NOT resurrected to the $2 floor)", () => {
    const q = computeServiceFee({
      baseAmountCents: 3_000, // would floor to $2 if any cap remained
      waived: false,
      capUsedCents: SERVICE_FEE_CAP_CENTS,
    });
    expect(q.platformPortionCents).toBe(0);
    expect(q.capApplied).toBe(true);
    expect(q.floorApplied).toBe(false);
    // The client still pays processing on the base.
    expect(q.processingPortionCents).toBeGreaterThan(0);
  });
});

describe("computeServiceFee — Pro waiver", () => {
  it("waives the platform portion but still charges processing at cost", () => {
    const q = computeServiceFee({ baseAmountCents: 100_000, waived: true });
    expect(q.platformPortionCents).toBe(0);
    expect(q.waived).toBe(true);
    expect(q.processingPortionCents).toBeGreaterThan(0);
    expect(q.totalFeeCents).toBe(q.processingPortionCents);
  });
});

describe("computeServiceFee — structural invariants", () => {
  const bases = [101, 3_000, 15_000, 100_000, 198_000, 1_000_000];

  for (const base of bases) {
    for (const waived of [false, true]) {
      it(`tradesperson nets exactly the base ($${(base / 100).toFixed(2)}, waived=${waived})`, () => {
        const q = computeServiceFee({ baseAmountCents: base, waived });
        // What the connected account receives = charge − application_fee.
        expect(q.chargeTotalCents - q.totalFeeCents).toBe(base);
      });

      it(`platform nets ≥ its portion after Stripe's cut ($${(base / 100).toFixed(2)}, waived=${waived})`, () => {
        const q = computeServiceFee({ baseAmountCents: base, waived });
        // Stripe takes 2.9% + 30¢ from the whole charge (Stripe rounds its %).
        const stripeCost = Math.round(q.chargeTotalCents * STRIPE_RATE) + STRIPE_FIXED_CENTS;
        const platformNet = q.totalFeeCents - stripeCost;
        // The ceil gross-up guarantees the platform never goes negative on the
        // processing leg; it nets its platform portion ±1¢.
        expect(platformNet).toBeGreaterThanOrEqual(q.platformPortionCents - 1);
      });
    }
  }

  it("totalFee = platform + processing for every case", () => {
    for (const base of bases) {
      const q = computeServiceFee({ baseAmountCents: base, waived: false });
      expect(q.totalFeeCents).toBe(q.platformPortionCents + q.processingPortionCents);
    }
  });

  it("rejects non-positive / non-integer bases", () => {
    expect(() => computeServiceFee({ baseAmountCents: 0, waived: false })).toThrow();
    expect(() => computeServiceFee({ baseAmountCents: -100, waived: false })).toThrow();
    expect(() => computeServiceFee({ baseAmountCents: 10.5, waived: false })).toThrow();
  });
});
