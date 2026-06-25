// M5b — the money-critical commission core. Covers the owner resolver (referral
// beats region, deactivated falls back), accrual (correct 10% entry, idempotent
// replay, no-op when unowned/waived), and reversal (offsetting entry, idempotent,
// no-op when nothing accrued).

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});

import { resolveCommissionOwner } from "../../src/lib/commissionOwner";
import { accrueCommission, reverseCommission } from "../../src/lib/commissionAccrual";
import { db } from "../../src/lib/admin";

const fakeDb = db as unknown as FakeFirestore;

const TID = "tradie-1";
const REP = "rep-1";
const REGION_REP = "rep-region";
const REGION = "region-north";

function seedTradie(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`tradespeople/${TID}`, {
    referredByRepId: null,
    regionId: null,
    ...over,
  });
}
function seedRep(uid: string, over: Record<string, unknown> = {}): void {
  fakeDb.seed(`users/${uid}`, { salesRep: { active: true, ...over } });
}
function seedRegion(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`regions/${REGION}`, { repId: REGION_REP, ...over });
}

beforeEach(() => fakeDb.reset());

describe("resolveCommissionOwner — unified ownership rule", () => {
  it("referral beats region when the referring rep is active", async () => {
    seedTradie({ referredByRepId: REP, regionId: REGION });
    seedRep(REP);
    seedRegion();
    expect(await resolveCommissionOwner(TID)).toEqual({
      repId: REP,
      regionId: REGION,
      ownerKind: "referral",
    });
  });

  it("treats a rep with no explicit active flag as active (default-active)", async () => {
    seedTradie({ referredByRepId: REP });
    fakeDb.seed(`users/${REP}`, { salesRep: { referralCode: "ABC" } });
    expect(await resolveCommissionOwner(TID)).toMatchObject({
      repId: REP,
      ownerKind: "referral",
    });
  });

  it("a DEACTIVATED referral rep falls back to the region rep", async () => {
    seedTradie({ referredByRepId: REP, regionId: REGION });
    seedRep(REP, { active: false });
    seedRegion();
    expect(await resolveCommissionOwner(TID)).toEqual({
      repId: REGION_REP,
      regionId: REGION,
      ownerKind: "region",
    });
  });

  it("a deactivated referral rep with NO region resolves to nobody", async () => {
    seedTradie({ referredByRepId: REP, regionId: null });
    seedRep(REP, { active: false });
    expect(await resolveCommissionOwner(TID)).toBeNull();
  });

  it("region ownership when there is no referral", async () => {
    seedTradie({ regionId: REGION });
    seedRegion();
    expect(await resolveCommissionOwner(TID)).toEqual({
      repId: REGION_REP,
      regionId: REGION,
      ownerKind: "region",
    });
  });

  it("a region with no assigned rep resolves to nobody", async () => {
    seedTradie({ regionId: REGION });
    seedRegion({ repId: null });
    expect(await resolveCommissionOwner(TID)).toBeNull();
  });

  it("no referral and no region resolves to nobody", async () => {
    seedTradie();
    expect(await resolveCommissionOwner(TID)).toBeNull();
  });

  it("a missing tradesperson doc resolves to nobody", async () => {
    expect(await resolveCommissionOwner("ghost")).toBeNull();
  });
});

describe("accrueCommission", () => {
  it("writes one 10% service-fee entry keyed by source_sourceRef", async () => {
    seedTradie({ referredByRepId: REP, regionId: REGION });
    seedRep(REP);
    seedRegion();

    await accrueCommission({
      tradespersonId: TID,
      source: "service_fee",
      sourceRef: "invoice-9",
      grossCents: 5000,
    });

    const entry = fakeDb.peek("commissions/service_fee_invoice-9");
    expect(entry).toMatchObject({
      repId: REP,
      regionId: REGION,
      tradespersonId: TID,
      ownerKind: "referral",
      source: "service_fee",
      sourceRef: "invoice-9",
      grossRevenueCents: 5000,
      rateBps: 1000,
      commissionCents: 500,
      status: "accrued",
      payoutBatchId: null,
      reversalOf: null,
      createdAt: "__serverTimestamp__",
    });
    expect(fakeDb.peekUnder("commissions")).toHaveLength(1);
  });

  it("is idempotent — a webhook replay overwrites the same doc, never doubles", async () => {
    seedTradie({ regionId: REGION });
    seedRegion();
    const input = {
      tradespersonId: TID,
      source: "subscription" as const,
      sourceRef: "in_abc",
      grossCents: 2900,
    };
    await accrueCommission(input);
    await accrueCommission(input);

    expect(fakeDb.peekUnder("commissions")).toHaveLength(1);
    expect(fakeDb.peek("commissions/subscription_in_abc")).toMatchObject({
      ownerKind: "region",
      commissionCents: 290,
    });
  });

  it("no-ops when the commission rounds to 0 (Pro tradie's waived fee)", async () => {
    seedTradie({ regionId: REGION });
    seedRegion();
    await accrueCommission({
      tradespersonId: TID,
      source: "service_fee",
      sourceRef: "invoice-waived",
      grossCents: 0,
    });
    expect(fakeDb.peekUnder("commissions")).toHaveLength(0);
  });

  it("no-ops when the tradesperson has no owning rep", async () => {
    seedTradie(); // no referral, no region
    await accrueCommission({
      tradespersonId: TID,
      source: "subscription",
      sourceRef: "in_unowned",
      grossCents: 2900,
    });
    expect(fakeDb.peekUnder("commissions")).toHaveLength(0);
  });
});

describe("reverseCommission", () => {
  async function seedAccrual(): Promise<void> {
    seedTradie({ regionId: REGION });
    seedRegion();
    await accrueCommission({
      tradespersonId: TID,
      source: "service_fee",
      sourceRef: "invoice-9",
      grossCents: 5000,
    });
  }

  it("writes an offsetting reversed entry mirroring the original, never mutating it", async () => {
    await seedAccrual();
    await reverseCommission({ source: "service_fee", sourceRef: "invoice-9" });

    const reversal = fakeDb.peek("commissions/service_fee_invoice-9_reversal");
    expect(reversal).toMatchObject({
      repId: REGION_REP,
      regionId: REGION,
      tradespersonId: TID,
      ownerKind: "region",
      source: "service_fee",
      sourceRef: "invoice-9",
      grossRevenueCents: 5000,
      commissionCents: 500,
      status: "reversed",
      reversalOf: "service_fee_invoice-9",
      createdAt: "__serverTimestamp__",
    });
    // Original is untouched (still accrued).
    expect(fakeDb.peek("commissions/service_fee_invoice-9")).toMatchObject({
      status: "accrued",
    });
    expect(fakeDb.peekUnder("commissions")).toHaveLength(2);
  });

  it("is idempotent — refund replay (or refund-then-dispute) yields one reversal", async () => {
    await seedAccrual();
    await reverseCommission({ source: "service_fee", sourceRef: "invoice-9" });
    await reverseCommission({ source: "service_fee", sourceRef: "invoice-9" });
    expect(fakeDb.peekUnder("commissions")).toHaveLength(2); // accrual + one reversal
  });

  it("no-ops when there was no accrual to reverse", async () => {
    await reverseCommission({ source: "service_fee", sourceRef: "never-accrued" });
    expect(fakeDb.peekUnder("commissions")).toHaveLength(0);
  });
});
