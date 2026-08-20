// Stripe Connect onboarding — the failure modes that broke "Start Stripe setup"
// after the live cutover (2026-08-19).
//
// Two defects, both covered here:
//   1. Nothing caught Stripe errors, so a rejection escaped onCall as a raw
//      throw and reached the tradesperson as a bare INTERNAL with the reason
//      only in the Cloud Functions log.
//   2. The stored `stripeAccountId` was trusted without checking it still
//      resolves. The cutover moved us to a DIFFERENT Stripe account, so every
//      sandbox `acct_` 404s against the live key — and a doc holding one could
//      never recover, because the create callable handed the dead id straight
//      back and the link call 404'd on it forever.

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

const { stripe } = vi.hoisted(() => ({
  stripe: {
    accounts: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      createLoginLink: vi.fn(),
    },
    accountLinks: { create: vi.fn() },
  },
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});
vi.mock("../../src/payments/stripeClient", async () => {
  const { emptyPayoutsState } = await import("../../src/payments/payoutsState");
  return {
    STRIPE_SECRET_KEY: { value: () => "sk_test_x" },
    emptyPayoutsState,
    getStripe: () => stripe,
  };
});

import { createConnectAccount } from "../../src/payments/createConnectAccount";
import { createConnectOnboardingLink } from "../../src/payments/createConnectOnboardingLink";
import { db } from "../../src/lib/admin";

const fakeDb = db as unknown as FakeFirestore;
const UID = "tradie-1";
const req = () => makeRequest({ data: undefined, uid: UID, role: "tradesperson" });

/** A Stripe 404 — what the live key returns for a sandbox-era account id. */
function noSuchAccount(id: string): Error {
  return Object.assign(new Error(`No such account: '${id}'`), {
    type: "StripeInvalidRequestError",
    rawType: "invalid_request_error",
    code: "resource_missing",
    statusCode: 404,
    requestId: "req_test",
  });
}

/** Any other Stripe rejection (bad param, rate limit, outage). */
function stripeRejected(message: string): Error {
  return Object.assign(new Error(message), {
    type: "StripeInvalidRequestError",
    rawType: "invalid_request_error",
    code: "parameter_invalid_integer",
    param: "settings[payouts][schedule][delay_days]",
    statusCode: 400,
    requestId: "req_test2",
  });
}

function seedTradie(payouts?: Record<string, unknown>): void {
  fakeDb.seed(`tradespeople/${UID}`, {
    displayName: "Smith Electric",
    ...(payouts ? { payouts } : {}),
  });
}

beforeEach(() => {
  fakeDb.reset();
  stripe.accounts.create.mockResolvedValue({ id: "acct_live_new" });
  stripe.accounts.retrieve.mockResolvedValue({ id: "acct_live_existing" });
  stripe.accounts.update.mockResolvedValue({ id: "acct_live_new" });
  stripe.accountLinks.create.mockResolvedValue({
    url: "https://connect.stripe.com/setup/x",
    expires_at: 123,
  });
});

describe("createConnectAccount", () => {
  it("creates an account and applies the 7-day payout hold", async () => {
    seedTradie();

    const res = await callFn(createConnectAccount, req());

    expect(res).toEqual({ stripeAccountId: "acct_live_new" });
    // The hold is applied as its own call, NOT inside accounts.create — a
    // rejected settings hash must not be able to block onboarding.
    expect(stripe.accounts.create.mock.calls[0][0]).not.toHaveProperty("settings");
    expect(stripe.accounts.update).toHaveBeenCalledWith("acct_live_new", {
      settings: { payouts: { schedule: { interval: "daily", delay_days: 7 } } },
    });
    expect(fakeDb.peek(`tradespeople/${UID}`)?.payouts).toMatchObject({
      stripeAccountId: "acct_live_new",
      onboardingStatus: "in_progress",
      payoutHoldDays: 7,
    });
  });

  it("still onboards when Stripe rejects the payout hold, recording the miss", async () => {
    seedTradie();
    stripe.accounts.update.mockRejectedValue(stripeRejected("invalid delay_days"));

    const res = await callFn(createConnectAccount, req());

    expect(res).toEqual({ stripeAccountId: "acct_live_new" });
    // Degraded, not silent: null says "on Stripe's default schedule".
    expect(fakeDb.peek(`tradespeople/${UID}`)?.payouts).toMatchObject({
      stripeAccountId: "acct_live_new",
      payoutHoldDays: null,
    });
  });

  it("returns the stored id when it still resolves at Stripe", async () => {
    seedTradie({ stripeAccountId: "acct_live_existing", onboardingStatus: "in_progress" });

    const res = await callFn(createConnectAccount, req());

    expect(res).toEqual({ stripeAccountId: "acct_live_existing" });
    expect(stripe.accounts.retrieve).toHaveBeenCalledWith("acct_live_existing");
    expect(stripe.accounts.create).not.toHaveBeenCalled();
  });

  it("replaces an orphaned sandbox id instead of handing it back", async () => {
    seedTradie({ stripeAccountId: "acct_sandbox_dead", onboardingStatus: "in_progress" });
    stripe.accounts.retrieve.mockRejectedValue(noSuchAccount("acct_sandbox_dead"));

    const res = await callFn(createConnectAccount, req());

    expect(res).toEqual({ stripeAccountId: "acct_live_new" });
    expect(stripe.accounts.create).toHaveBeenCalledTimes(1);
    expect(fakeDb.peek(`tradespeople/${UID}`)?.payouts).toMatchObject({
      stripeAccountId: "acct_live_new",
    });
  });

  it("does NOT discard the stored account when Stripe merely errors", async () => {
    seedTradie({ stripeAccountId: "acct_live_existing" });
    stripe.accounts.retrieve.mockRejectedValue(stripeRejected("service unavailable"));

    // "Stripe is having a bad day" must never be mistaken for "this account is
    // gone" — that would mint a duplicate account for a real tradesperson.
    await expectHttpsError(callFn(createConnectAccount, req()), "internal");
    expect(stripe.accounts.create).not.toHaveBeenCalled();
    expect(fakeDb.peek(`tradespeople/${UID}`)?.payouts).toMatchObject({
      stripeAccountId: "acct_live_existing",
    });
  });

  it("converts a Stripe failure into an HttpsError rather than a raw throw", async () => {
    seedTradie();
    stripe.accounts.create.mockRejectedValue(stripeRejected("bad request"));

    const err = await expectHttpsError(callFn(createConnectAccount, req()), "internal");
    // Stripe's own message never reaches the client.
    expect(err.message).not.toContain("bad request");
  });

  it("rejects a caller with no tradesperson profile", async () => {
    await expectHttpsError(callFn(createConnectAccount, req()), "failed-precondition");
  });
});

describe("createConnectOnboardingLink", () => {
  it("mints a link for a healthy account", async () => {
    seedTradie({ stripeAccountId: "acct_live_existing" });

    const res = await callFn(createConnectOnboardingLink, req());

    expect(res).toEqual({
      url: "https://connect.stripe.com/setup/x",
      expiresAt: 123,
    });
  });

  it("clears an orphaned id so the next click starts clean", async () => {
    seedTradie({ stripeAccountId: "acct_sandbox_dead", onboardingStatus: "in_progress" });
    stripe.accountLinks.create.mockRejectedValue(noSuchAccount("acct_sandbox_dead"));

    await expectHttpsError(callFn(createConnectOnboardingLink, req()), "failed-precondition");

    // Reset to a clean not_started block — the panel now shows "Start Stripe
    // setup" and the create callable will mint a live account.
    expect(fakeDb.peek(`tradespeople/${UID}`)?.payouts).toMatchObject({
      stripeAccountId: null,
      onboardingStatus: "not_started",
    });
  });

  it("keeps the stored id on an unrelated Stripe error", async () => {
    seedTradie({ stripeAccountId: "acct_live_existing" });
    stripe.accountLinks.create.mockRejectedValue(stripeRejected("rate limited"));

    await expectHttpsError(callFn(createConnectOnboardingLink, req()), "internal");
    expect(fakeDb.peek(`tradespeople/${UID}`)?.payouts).toMatchObject({
      stripeAccountId: "acct_live_existing",
    });
  });
});
