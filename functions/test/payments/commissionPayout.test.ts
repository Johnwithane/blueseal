// M6b — the rep payout netting + decision (pure money math). The scheduler's
// claim/transfer/unwind orchestration is verified end-to-end on real Firestore.

import { describe, it, expect } from "vitest";
import { planRepPayout, MIN_PAYOUT_CENTS } from "../../src/lib/commissionPayout";

const NOW = 1_750_000_000_000;
const row = (id: string, cents: number, createdAtMs: number | null = null) => ({
  id,
  commissionCents: cents,
  createdAtMs,
});

describe("planRepPayout — netting + decision", () => {
  it("pays the full accrued sum when above the minimum, no reversals", () => {
    const plan = planRepPayout([row("a", 4000), row("b", 3000)], [], NOW);
    expect(plan.accruedSum).toBe(7000);
    expect(plan.reversedSum).toBe(0);
    expect(plan.netCents).toBe(7000);
    expect(plan.shouldPay).toBe(true);
    expect(plan.commissionIds).toEqual(["a", "b"]);
  });

  it("nets accrued minus reversed", () => {
    const plan = planRepPayout([row("a", 9000)], [row("r", 1500)], NOW);
    expect(plan.netCents).toBe(7500);
    expect(plan.shouldPay).toBe(true);
    // The reversal id is settled in the same batch so it never nets again.
    expect(plan.commissionIds).toEqual(["a", "r"]);
  });

  it("rolls over when the net is below the minimum", () => {
    const plan = planRepPayout([row("a", 4999)], [], NOW);
    expect(plan.netCents).toBe(4999);
    expect(plan.shouldPay).toBe(false);
  });

  it("pays at exactly the minimum (>= boundary)", () => {
    const plan = planRepPayout([row("a", MIN_PAYOUT_CENTS)], [], NOW);
    expect(plan.netCents).toBe(MIN_PAYOUT_CENTS);
    expect(plan.shouldPay).toBe(true);
  });

  it("rolls over when reversals drag the net below the minimum", () => {
    const plan = planRepPayout([row("a", 6000)], [row("r", 2000)], NOW);
    expect(plan.netCents).toBe(4000);
    expect(plan.shouldPay).toBe(false);
  });

  it("rolls over a negative net (reversals exceed accrued)", () => {
    const plan = planRepPayout([row("a", 1000)], [row("r", 9000)], NOW);
    expect(plan.netCents).toBe(-8000);
    expect(plan.shouldPay).toBe(false);
  });

  it("uses the earliest accrued createdAt as the period start", () => {
    const early = NOW - 30 * 86_400_000;
    const plan = planRepPayout(
      [row("a", 3000, NOW - 10 * 86_400_000), row("b", 3000, early)],
      [],
      NOW,
    );
    expect(plan.periodStartMs).toBe(early);
  });

  it("falls back to nowMs for period start when no createdAt is present", () => {
    const plan = planRepPayout([row("a", 6000, null)], [], NOW);
    expect(plan.periodStartMs).toBe(NOW);
  });
});
