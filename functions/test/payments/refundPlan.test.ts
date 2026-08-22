// Who bears a refund (ToS § 8.1). A wrong answer here silently makes Blue Seal
// subsidize tradespeople's refunds, or takes cents off a tradesperson that they
// never received — neither shows up as an error anywhere.

import { describe, it, expect } from "vitest";
import { isDisputeResolved, planRefund } from "../../src/payments/refundPlan";

// A $480 invoice: the client paid $505.36, the tradesperson received $480.00,
// Blue Seal kept $25.36 of service fee.
const CHARGE = 50_536;
const BASE = 48_000;

describe("planRefund — full refund", () => {
  it("returns the whole charge, including the Blue Seal service fee", () => {
    const d = planRefund({
      chargeTotalCents: CHARGE,
      baseAmountCents: BASE,
      alreadyRefundedCents: 0,
      requestedCents: null,
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.plan).toEqual({
      amountCents: CHARGE,
      isFull: true,
      // Stripe's proportional unwind is exactly right when everything goes back.
      reverseTransfer: true,
      refundApplicationFee: true,
      transferReversalCents: 0,
    });
  });

  it("treats an amount that covers the remainder as a full refund", () => {
    const d = planRefund({
      chargeTotalCents: CHARGE,
      baseAmountCents: BASE,
      alreadyRefundedCents: 0,
      requestedCents: CHARGE,
    });
    expect(d.ok && d.plan.isFull).toBe(true);
  });

  it("refunds only what's left after an earlier partial refund", () => {
    const d = planRefund({
      chargeTotalCents: CHARGE,
      baseAmountCents: BASE,
      alreadyRefundedCents: 10_000,
      requestedCents: null,
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.plan.amountCents).toBe(CHARGE - 10_000);
    expect(d.plan.isFull).toBe(true);
  });
});

describe("planRefund — partial refund", () => {
  it("takes the amount from the tradesperson and keeps the service fee", () => {
    const d = planRefund({
      chargeTotalCents: CHARGE,
      baseAmountCents: BASE,
      alreadyRefundedCents: 0,
      requestedCents: 10_000,
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.plan).toEqual({
      amountCents: 10_000,
      isFull: false,
      // NOT Stripe's proportional unwind: that would pull only ~95% back from
      // the tradesperson and leave Blue Seal funding the rest. We reverse the
      // full refunded amount explicitly instead.
      reverseTransfer: false,
      refundApplicationFee: false,
      transferReversalCents: 10_000,
    });
  });

  it("refuses a partial refund larger than the tradesperson's share", () => {
    // The client paid $505.36 but the tradesperson only ever received $480 —
    // a $490 "partial" would take fee revenue off Blue Seal too.
    const d = planRefund({
      chargeTotalCents: CHARGE,
      baseAmountCents: BASE,
      alreadyRefundedCents: 0,
      requestedCents: 49_000,
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("exceeds_tradesperson_share");
    expect(d.limitCents).toBe(BASE);
  });

  it("shrinks the tradesperson's remaining share as refunds accumulate", () => {
    const d = planRefund({
      chargeTotalCents: CHARGE,
      baseAmountCents: BASE,
      alreadyRefundedCents: 40_000,
      requestedCents: 9_000,
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.limitCents).toBe(BASE - 40_000);
  });

  it("rejects a non-positive amount", () => {
    const d = planRefund({
      chargeTotalCents: CHARGE,
      baseAmountCents: BASE,
      alreadyRefundedCents: 0,
      requestedCents: -100,
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("amount_not_positive");
  });
});

describe("isDisputeResolved", () => {
  // `payment.disputeId` stays set forever once a dispute has existed, so
  // gating a refund on the id alone would permanently block a tradesperson
  // who WON — the case where they're holding the money and may still want to
  // refund the client themselves.
  it("treats a live dispute as unresolved", () => {
    for (const s of ["needs_response", "under_review", "warning_needs_response"]) {
      expect(isDisputeResolved(s)).toBe(false);
    }
  });

  it("treats a closed dispute as resolved", () => {
    for (const s of ["won", "lost", "warning_closed"]) {
      expect(isDisputeResolved(s)).toBe(true);
    }
  });

  it("treats a missing status as unresolved (fail closed)", () => {
    expect(isDisputeResolved(null)).toBe(false);
  });
});

describe("planRefund — nothing left", () => {
  it("refuses once the charge is fully refunded", () => {
    for (const requestedCents of [null, 500]) {
      const d = planRefund({
        chargeTotalCents: CHARGE,
        baseAmountCents: BASE,
        alreadyRefundedCents: CHARGE,
        requestedCents,
      });
      expect(d.ok).toBe(false);
      if (d.ok) return;
      expect(d.reason).toBe("nothing_to_refund");
    }
  });
});
