import { describe, it, expect } from "vitest";
import { summarizeRepEarnings, MIN_PAYOUT_CENTS } from "./repEarnings";
import type { CommissionDoc, CommissionPayoutDoc, WithId } from "@/firebase/interfaces";

const c = (over: Partial<CommissionDoc> & { id: string }): WithId<CommissionDoc> =>
  ({
    repId: "rep", regionId: null, tradespersonId: "t1", ownerKind: "referral",
    source: "service_fee", sourceRef: "x", grossRevenueCents: 0, rateBps: 1000,
    commissionCents: 0, status: "accrued", payoutBatchId: null, reversalOf: null,
    createdAt: { toDate: () => new Date() } as never, ...over,
  }) as WithId<CommissionDoc>;

const p = (over: Partial<CommissionPayoutDoc> & { id: string }): WithId<CommissionPayoutDoc> =>
  ({
    repId: "rep", stripeTransferId: "tr", amountCents: 0, commissionIds: [],
    periodStart: {} as never, periodEnd: {} as never, status: "paid",
    createdAt: {} as never, ...over,
  }) as WithId<CommissionPayoutDoc>;

describe("summarizeRepEarnings", () => {
  it("nets accrued minus un-netted reversed for the unpaid balance", () => {
    const s = summarizeRepEarnings(
      [
        c({ id: "a", status: "accrued", commissionCents: 4000, tradespersonId: "t1" }),
        c({ id: "b", status: "accrued", commissionCents: 3000, tradespersonId: "t2" }),
        c({ id: "r", status: "reversed", commissionCents: 1000, tradespersonId: "t1", payoutBatchId: null }),
      ],
      [],
    );
    expect(s.unpaidCents).toBe(6000);
    expect(s.earnerCount).toBe(2);
    expect(s.meetsMinimum).toBe(true);
  });

  it("ignores reversed entries already settled in a batch", () => {
    const s = summarizeRepEarnings(
      [
        c({ id: "a", status: "accrued", commissionCents: 6000 }),
        c({ id: "r", status: "reversed", commissionCents: 2000, payoutBatchId: "batch-1" }),
      ],
      [],
    );
    expect(s.unpaidCents).toBe(6000); // the netted reversal doesn't subtract again
  });

  it("clamps a negative unpaid balance to zero", () => {
    const s = summarizeRepEarnings(
      [
        c({ id: "a", status: "accrued", commissionCents: 1000 }),
        c({ id: "r", status: "reversed", commissionCents: 9000, payoutBatchId: null }),
      ],
      [],
    );
    expect(s.unpaidCents).toBe(0);
    expect(s.meetsMinimum).toBe(false);
  });

  it("sums lifetime paid from settled batches only", () => {
    const s = summarizeRepEarnings(
      [],
      [
        p({ id: "b1", status: "paid", amountCents: 6000 }),
        p({ id: "b2", status: "paid", amountCents: 5000 }),
        p({ id: "b3", status: "failed", amountCents: 7000 }),
        p({ id: "b4", status: "pending", amountCents: 8000 }),
      ],
    );
    expect(s.lifetimePaidCents).toBe(11000);
    expect(s.pendingBatchCount).toBe(2); // failed + pending
  });

  it("ranks tradespeople by net contribution, reversed counts negative", () => {
    const s = summarizeRepEarnings(
      [
        c({ id: "a", status: "paid", commissionCents: 5000, tradespersonId: "big" }),
        c({ id: "b", status: "accrued", commissionCents: 800, tradespersonId: "small" }),
        c({ id: "r", status: "reversed", commissionCents: 200, tradespersonId: "small", payoutBatchId: null }),
      ],
      [],
    );
    expect(s.byTradie[0]).toEqual({ tradespersonId: "big", netCents: 5000 });
    expect(s.byTradie[1]).toEqual({ tradespersonId: "small", netCents: 600 });
  });

  it("MIN_PAYOUT_CENTS is $50", () => {
    expect(MIN_PAYOUT_CENTS).toBe(5000);
  });
});
