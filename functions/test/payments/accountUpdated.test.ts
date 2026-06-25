// account.updated routing (M6): a rep Connect account (metadata.repId) mirrors
// to users/{uid}.salesRep.payouts with a payouts-only status; a tradesperson
// account (metadata.tradespersonId) still mirrors to tradespeople/{uid}.payouts.

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});

import { handleAccountUpdated } from "../../src/payments/handlers/accountUpdated";
import { db } from "../../src/lib/admin";

const fakeDb = db as unknown as FakeFirestore;

const REP = "rep-1";
const TRADIE = "tradie-1";

// A fully-onboarded transfers-only rep account: payouts on, charges OFF.
function repAccount(over: Record<string, unknown> = {}) {
  return {
    id: "acct_rep",
    payouts_enabled: true,
    charges_enabled: false,
    details_submitted: true,
    requirements: { disabled_reason: null, currently_due: [], past_due: [] },
    metadata: { repId: REP },
    ...over,
  };
}

beforeEach(() => fakeDb.reset());

describe("account.updated — rep routing", () => {
  it("mirrors a rep account onto users/{uid}.salesRep.payouts, enabled on payouts alone", async () => {
    fakeDb.seed(`users/${REP}`, {
      salesRep: { referralCode: "JOHNNYK", active: true },
    });

    await handleAccountUpdated(repAccount() as never);

    const payouts = fakeDb.peek(`users/${REP}`)?.salesRep?.payouts;
    expect(payouts).toMatchObject({
      stripeAccountId: "acct_rep",
      // charges_enabled is false, but a rep is "enabled" on payout readiness alone.
      onboardingStatus: "enabled",
      payoutsEnabled: true,
      chargesEnabled: false,
      detailsSubmitted: true,
      disabledReason: null,
      pendingRequirements: [],
      lastSyncedAt: "__serverTimestamp__",
    });
  });

  it("marks a rep in_progress while requirements are still due", async () => {
    fakeDb.seed(`users/${REP}`, { salesRep: { active: true } });
    await handleAccountUpdated(
      repAccount({
        payouts_enabled: false,
        details_submitted: false,
        requirements: { disabled_reason: null, currently_due: ["external_account"], past_due: [] },
      }) as never,
    );
    const payouts = fakeDb.peek(`users/${REP}`)?.salesRep?.payouts;
    expect(payouts?.onboardingStatus).toBe("in_progress");
    expect(payouts?.pendingRequirements).toEqual(["external_account"]);
  });

  it("no-ops when the rep user has no salesRep (never wrote payouts)", async () => {
    fakeDb.seed(`users/${REP}`, { roles: ["client", "sales"] }); // no salesRep
    await handleAccountUpdated(repAccount() as never);
    expect(fakeDb.peek(`users/${REP}`)?.salesRep).toBeUndefined();
  });
});

describe("account.updated — tradesperson routing unchanged", () => {
  it("a tradesperson account still mirrors to tradespeople/{uid}.payouts", async () => {
    fakeDb.seed(`tradespeople/${TRADIE}`, { displayName: "T" });
    await handleAccountUpdated({
      id: "acct_tradie",
      payouts_enabled: true,
      charges_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: null, currently_due: [], past_due: [] },
      metadata: { tradespersonId: TRADIE },
    } as never);

    const payouts = fakeDb.peek(`tradespeople/${TRADIE}`)?.payouts;
    expect(payouts).toMatchObject({
      stripeAccountId: "acct_tradie",
      onboardingStatus: "enabled",
      payoutsEnabled: true,
      chargesEnabled: true,
    });
    // The rep doc was never touched.
    expect(fakeDb.peek(`users/${REP}`)).toBeUndefined();
  });
});
