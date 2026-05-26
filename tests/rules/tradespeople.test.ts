// tradespeople/{tradieId} — field-lock coverage for the server-managed
// Stripe Connect + verified-earnings fields added in the monetization
// pivot. Owner can update bio/etc, but cannot self-grant payouts state
// or paid-earnings stats.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { GeoPoint, doc, setDoc, updateDoc } from "firebase/firestore";

import { TRADIE_CLAIMS, TRADIE_UID, setupTestEnv } from "./setup";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

// Baseline approved-tradie doc with the *pre-cutover* shape (no payouts /
// paidJobsCount / paidLifetimeCents). Many fields are present because the
// /tradespeople update rule pins them via positive equality checks — leaving
// them out would make the update fail for unrelated reasons and obscure
// what we're actually testing.
const baselineTradie = {
  displayName: "Bob Plumber",
  photoURL: null,
  companyName: null,
  languages: ["English"],
  bio: "I plumb",
  trades: ["plumbing"],
  yearsExperience: { plumbing: 5 },
  pricingModel: "hourly",
  hourlyRate: 10_000,
  providesFreeQuotes: true,
  location: new GeoPoint(49.2827, -123.1207),
  geohash: "c2b2",
  serviceRadiusKm: 25,
  primaryAddressText: "Vancouver, BC",
  portfolioPhotos: [],
  ratingAvg: 0,
  ratingCount: 0,
  ratingDimensions: {
    quality: { avg: 0, count: 0 },
    punctuality: { avg: 0, count: 0 },
    communication: { avg: 0, count: 0 },
    value: { avg: 0, count: 0 },
  },
  verifiedTrades: [],
  idVerified: false,
  insuranceVerified: false,
  insuranceExpiresAt: null,
  wsibVerified: false,
  wsibExpiresAt: null,
  vettingStatus: "approved",
  vettingNotes: "",
  isVisible: true,
  weeklyAvailability: {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  },
  nextInvoiceNumber: 1,
  paymentInstructions: "",
  submittedAt: null,
  approvedAt: null,
};

async function seedTradie() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), "tradespeople", TRADIE_UID),
      baselineTradie,
    );
  });
}

describe("tradespeople — server-managed field locks", () => {
  it("owner can update bio without touching server-managed fields", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), {
        bio: "I plumb very well now",
      }),
    );
  });

  it("owner cannot self-grant a Connect payouts state", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), {
        payouts: {
          stripeAccountId: "acct_self_granted",
          onboardingStatus: "enabled",
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
          disabledReason: null,
          pendingRequirements: [],
          lastSyncedAt: null,
        },
      }),
    );
  });

  it("owner cannot inflate paidJobsCount", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { paidJobsCount: 99 }),
    );
  });

  it("owner cannot inflate paidLifetimeCents", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), {
        paidLifetimeCents: 999_000_00,
      }),
    );
  });

  // Invoice/quote numbering customisation is server-managed via the
  // setInvoiceNumbering callable — the owner can't change the prefix or
  // skip the sequence from the client. companyLogoUrl is owner-editable
  // so they can swap their logo without round-tripping through a
  // callable.
  it("owner cannot self-set invoicePrefix", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { invoicePrefix: "ACME" }),
    );
  });

  it("owner cannot self-set quotePrefix", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { quotePrefix: "EST" }),
    );
  });

  it("owner cannot self-set nextQuoteNumber", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { nextQuoteNumber: 9000 }),
    );
  });

  it("owner can set companyLogoUrl", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), {
        companyLogoUrl:
          "https://firebasestorage.googleapis.com/v0/b/test.appspot.com/o/logo.webp",
      }),
    );
  });
});
