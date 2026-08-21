// The clamping rules behind ToS § 8.4 fund recovery. Getting these wrong is a
// money bug in both directions: over-reversing takes cents the tradesperson
// never received, under-reversing leaves Blue Seal absorbing the difference.

import { describe, it, expect } from "vitest";
import { computeReversalCents } from "../../src/payments/disputeRecovery";

describe("computeReversalCents", () => {
  it("reverses the whole transfer when the dispute exceeds it", () => {
    // The real shape of every dispute: the client charged back the full charge
    // (invoice + Blue Seal service fee) but the transfer only ever carried the
    // invoice total, so the fee difference can't come out of the tradesperson.
    expect(
      computeReversalCents({
        disputeAmountCents: 10_500,
        transferAmountCents: 10_000,
        alreadyReversedCents: 0,
      }),
    ).toBe(10_000);
  });

  it("reverses only the disputed amount on a partial dispute", () => {
    expect(
      computeReversalCents({
        disputeAmountCents: 4_000,
        transferAmountCents: 10_000,
        alreadyReversedCents: 0,
      }),
    ).toBe(4_000);
  });

  it("accounts for cents already reversed (refund first, then dispute)", () => {
    expect(
      computeReversalCents({
        disputeAmountCents: 10_000,
        transferAmountCents: 10_000,
        alreadyReversedCents: 6_000,
      }),
    ).toBe(4_000);
  });

  it("returns 0 when the transfer is already fully reversed", () => {
    expect(
      computeReversalCents({
        disputeAmountCents: 10_000,
        transferAmountCents: 10_000,
        alreadyReversedCents: 10_000,
      }),
    ).toBe(0);
  });

  it("never returns a negative amount", () => {
    expect(
      computeReversalCents({
        disputeAmountCents: 10_000,
        transferAmountCents: 10_000,
        alreadyReversedCents: 12_000,
      }),
    ).toBe(0);
    expect(
      computeReversalCents({
        disputeAmountCents: 0,
        transferAmountCents: 10_000,
        alreadyReversedCents: 0,
      }),
    ).toBe(0);
  });

  it("handles a charge with no transfer at all", () => {
    expect(
      computeReversalCents({
        disputeAmountCents: 10_000,
        transferAmountCents: 0,
        alreadyReversedCents: 0,
      }),
    ).toBe(0);
  });
});
