// Card-payment ceilings and the 3DS threshold. These decide whether a real
// client can pay a real invoice, so the boundaries are pinned exactly.

import { describe, it, expect } from "vitest";
import {
  MAX_CARD_PAYMENT_CENTS,
  NEW_TRADIE_CARD_CAP_CENTS,
  THREE_DS_FORCE_ABOVE_CENTS,
  assessCardPayment,
  daysSince,
  formatLimit,
  isNewTradesperson,
  threeDSecurePreference,
} from "../../src/payments/paymentRisk";

describe("isNewTradesperson", () => {
  it("is new below the paid-jobs threshold, whatever the account age", () => {
    expect(isNewTradesperson({ paidJobsCount: 0, daysSinceApproved: 400 })).toBe(true);
    expect(isNewTradesperson({ paidJobsCount: 2, daysSinceApproved: 400 })).toBe(true);
  });

  it("is new while the account is young, even with paid jobs behind it", () => {
    // The fraud pattern this catches: onboard, run several payments the same
    // week, withdraw. Job count alone would clear them.
    expect(isNewTradesperson({ paidJobsCount: 10, daysSinceApproved: 3 })).toBe(true);
  });

  it("is established once both signals clear", () => {
    expect(isNewTradesperson({ paidJobsCount: 3, daysSinceApproved: 30 })).toBe(false);
  });

  it("treats an unknown approval date as established when jobs clear", () => {
    // Pre-backfill docs have no approvedAt. Don't invent risk from a missing
    // field — the paid-job count is the load-bearing signal.
    expect(isNewTradesperson({ paidJobsCount: 5, daysSinceApproved: null })).toBe(false);
    expect(isNewTradesperson({ paidJobsCount: 1, daysSinceApproved: null })).toBe(true);
  });
});

describe("assessCardPayment", () => {
  const established = { paidJobsCount: 10, daysSinceApproved: 200 };
  const fresh = { paidJobsCount: 0, daysSinceApproved: 1 };

  it("allows a normal job for an established tradesperson", () => {
    const a = assessCardPayment({ baseAmountCents: 48_000, ...established });
    expect(a.allowed).toBe(true);
    expect(a.limitCents).toBe(MAX_CARD_PAYMENT_CENTS);
    expect(a.isNew).toBe(false);
  });

  it("refuses above the hard ceiling", () => {
    expect(
      assessCardPayment({ baseAmountCents: MAX_CARD_PAYMENT_CENTS + 1, ...established }).allowed,
    ).toBe(false);
    // Exactly at the ceiling is fine — the limit is inclusive.
    expect(
      assessCardPayment({ baseAmountCents: MAX_CARD_PAYMENT_CENTS, ...established }).allowed,
    ).toBe(true);
  });

  it("holds a new tradesperson to the lower ceiling", () => {
    const a = assessCardPayment({ baseAmountCents: NEW_TRADIE_CARD_CAP_CENTS + 1, ...fresh });
    expect(a.allowed).toBe(false);
    expect(a.limitCents).toBe(NEW_TRADIE_CARD_CAP_CENTS);
    expect(a.isNew).toBe(true);
    // …and the same amount is fine once they're established.
    expect(
      assessCardPayment({ baseAmountCents: NEW_TRADIE_CARD_CAP_CENTS + 1, ...established })
        .allowed,
    ).toBe(true);
  });
});

describe("threeDSecurePreference", () => {
  it("lets Stripe decide on small payments", () => {
    expect(threeDSecurePreference(5_000)).toBe("automatic");
    expect(threeDSecurePreference(THREE_DS_FORCE_ABOVE_CENTS)).toBe("automatic");
  });

  it("always challenges above the threshold", () => {
    expect(threeDSecurePreference(THREE_DS_FORCE_ABOVE_CENTS + 1)).toBe("any");
    expect(threeDSecurePreference(500_000)).toBe("any");
  });
});

describe("daysSince", () => {
  const now = new Date("2026-08-21T12:00:00Z");

  it("counts whole elapsed days", () => {
    expect(daysSince(new Date("2026-08-11T12:00:00Z"), now)).toBe(10);
    expect(daysSince(new Date("2026-08-21T06:00:00Z"), now)).toBe(0);
  });

  it("returns null for an unknown date and never goes negative", () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince(new Date("2026-09-01T00:00:00Z"), now)).toBe(0);
  });
});

describe("formatLimit", () => {
  it("renders whole dollars for a human-facing message", () => {
    expect(formatLimit(250_000)).toBe("$2,500");
    expect(formatLimit(1_000_000)).toBe("$10,000");
  });
});
