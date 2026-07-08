// P3-04: refunding a card-paid upfront fee must give back the platform-fee
// portion of the per-job $99 cap it consumed, or the final invoice thinks the
// cap is used and under-collects. computeUpfrontCapGiveBack is the pure math.

import { describe, it, expect } from "vitest";
import { computeUpfrontCapGiveBack } from "../../src/payments/handlers/chargeRefunded";

describe("computeUpfrontCapGiveBack", () => {
  it("gives back the full platform portion on a full refund", () => {
    expect(
      computeUpfrontCapGiveBack({
        platformPortionCents: 500,
        totalUpfrontCents: 5000,
        prevRefundedCents: 0,
        amountRefundedCents: 5000,
        capUsedCents: 500,
      }),
    ).toBe(500);
  });

  it("prorates on a partial refund", () => {
    // Half the upfront refunded → half the platform portion given back.
    expect(
      computeUpfrontCapGiveBack({
        platformPortionCents: 500,
        totalUpfrontCents: 5000,
        prevRefundedCents: 0,
        amountRefundedCents: 2500,
        capUsedCents: 500,
      }),
    ).toBe(250);
  });

  it("only counts the newly-refunded delta (idempotent across repeat events)", () => {
    // amount_refunded is cumulative; we already gave back for 2500, so a second
    // event carrying 5000 cumulative only gives back the remaining 250.
    expect(
      computeUpfrontCapGiveBack({
        platformPortionCents: 500,
        totalUpfrontCents: 5000,
        prevRefundedCents: 2500,
        amountRefundedCents: 5000,
        capUsedCents: 250,
      }),
    ).toBe(250);
  });

  it("never gives back more cap than was used", () => {
    expect(
      computeUpfrontCapGiveBack({
        platformPortionCents: 500,
        totalUpfrontCents: 5000,
        prevRefundedCents: 0,
        amountRefundedCents: 5000,
        capUsedCents: 300, // cap already partly reset elsewhere
      }),
    ).toBe(300);
  });

  it("is zero when there was no platform portion or no upfront", () => {
    expect(
      computeUpfrontCapGiveBack({
        platformPortionCents: 0,
        totalUpfrontCents: 5000,
        prevRefundedCents: 0,
        amountRefundedCents: 5000,
        capUsedCents: 500,
      }),
    ).toBe(0);
    expect(
      computeUpfrontCapGiveBack({
        platformPortionCents: 500,
        totalUpfrontCents: 0,
        prevRefundedCents: 0,
        amountRefundedCents: 5000,
        capUsedCents: 500,
      }),
    ).toBe(0);
  });
});
