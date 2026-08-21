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
import { GeoPoint, Timestamp, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  OTHER_TRADIE_UID,
  TRADIE_CLAIMS,
  TRADIE_UID,
  setupTestEnv,
} from "./setup";

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
  // Public doc carries only the coarse search fields; the exact location +
  // address moved to the private/contact subdoc (see the describe block below).
  locationApprox: new GeoPoint(49.28, -123.12),
  geohashPublic: "c2b2bc",
  serviceRadiusKm: 25,
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

async function seedTradie(overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "tradespeople", TRADIE_UID), {
      ...baselineTradie,
      ...overrides,
    });
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

  // The card-payments kill switch (ToS § 7.7) is only worth anything if the
  // tradesperson it's aimed at can't clear it. Both directions are covered:
  // they can't lift a pause, and they can't invent the field either.
  it("owner cannot clear an admin card-payments pause", async () => {
    await seedTradie({
      payments: {
        cardPaymentsPausedAt: Timestamp.fromMillis(1_700_000_000_000),
        cardPaymentsPausedReason: "chargeback pattern",
        cardPaymentsPausedBy: ADMIN_UID,
      },
    });
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), {
        payments: {
          cardPaymentsPausedAt: null,
          cardPaymentsPausedReason: null,
          cardPaymentsPausedBy: null,
        },
      }),
    );
  });

  it("owner cannot self-set a payments block", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), {
        payments: { cardPaymentsPausedAt: null },
      }),
    );
  });

  it("admin can pause card payments", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), {
        payments: {
          cardPaymentsPausedAt: Timestamp.fromMillis(1_700_000_000_000),
          cardPaymentsPausedReason: "chargeback pattern",
          cardPaymentsPausedBy: ADMIN_UID,
        },
      }),
    );
  });

  it("owner can still edit their bio while paused", async () => {
    // A pause must not brick the rest of the profile — it's a payments
    // control, not an account suspension.
    await seedTradie({
      payments: {
        cardPaymentsPausedAt: Timestamp.fromMillis(1_700_000_000_000),
        cardPaymentsPausedReason: "chargeback pattern",
        cardPaymentsPausedBy: ADMIN_UID,
      },
    });
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { bio: "still plumbing" }),
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

  it("owner cannot self-grant a verifiedCredentials entry (would fake a Red Seal)", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), {
        verifiedCredentials: [
          { trade: "plumbing", issuingBody: "Red Seal Program", redSeal: true, expiresAt: null },
        ],
      }),
    );
  });

  it("owner can edit bio on a doc already carrying verifiedCredentials (optional-field trap regression)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "tradespeople", TRADIE_UID), {
        ...baselineTradie,
        verifiedTrades: ["plumbing"],
        verifiedCredentials: [
          { trade: "plumbing", issuingBody: "Red Seal Program", redSeal: true, expiresAt: null },
        ],
      });
    });
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { bio: "still plumbing" }),
    );
  });

  it("owner can edit bio on a legacy doc missing the insurance/WSIB fields (verification-badge trap regression)", async () => {
    // Repro of the prod bug (bugReports/7SuzO8QTyabNWf95EPUo): a draft created
    // by older code never initialised insuranceVerified / insuranceExpiresAt /
    // wsibVerified / wsibExpiresAt. A direct `resource.data.insuranceVerified`
    // in the update rule threw "Property ... is undefined" on those docs,
    // surfacing to the owner as permission-denied on the Short bio autosave.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const legacy = { ...baselineTradie } as Partial<typeof baselineTradie>;
      delete legacy.insuranceVerified;
      delete legacy.insuranceExpiresAt;
      delete legacy.wsibVerified;
      delete legacy.wsibExpiresAt;
      await setDoc(doc(ctx.firestore(), "tradespeople", TRADIE_UID), legacy);
    });
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { bio: "draft autosave" }),
    );
  });

  it("owner cannot self-grant insuranceVerified (would fake an insurance badge)", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { insuranceVerified: true }),
    );
  });

  it("owner cannot self-grant wsibVerified (would fake a WSIB badge)", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { wsibVerified: true }),
    );
  });

  it("owner cannot self-grant isPro (would win Featured placement for free)", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { isPro: true }),
    );
  });

  it("owner can edit bio on a doc already carrying isPro (legacy-doc trap regression)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "tradespeople", TRADIE_UID), {
        ...baselineTradie,
        isPro: true,
      });
    });
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { bio: "still plumbing" }),
    );
  });

  it("the public can read isPro on a visible tradie (drives the applicant sort)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "tradespeople", TRADIE_UID), {
        ...baselineTradie,
        isPro: true,
      });
    });
    const fs = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(fs, "tradespeople", TRADIE_UID)));
  });

  // `discoverable` is the owner's "show me in search" switch — deliberately
  // NOT in the server-managed lock list, so the owner can hide/relist freely.
  it("owner can hide their profile from search (set discoverable false)", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { discoverable: false }),
    );
  });

  it("owner can relist their profile (set discoverable true)", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { discoverable: true }),
    );
  });

  // The discoverable switch must NOT become a backdoor onto the server-managed
  // isVisible gate — flipping isVisible alongside it still has to fail.
  it("owner cannot ride discoverable to flip isVisible", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), {
        discoverable: false,
        isVisible: false,
      }),
    );
  });
});

// tradespeople/{uid}/private/contact — the exact location + (home) address.
// These were world-readable on the public doc (the F1 leak); the whole point
// of the subdoc is that NO ONE but the owner + admin can read them. The
// unauthenticated case is the mass-harvest scenario we're closing.
const CONTACT_PATH = ["tradespeople", TRADIE_UID, "private", "contact"] as const;

async function seedContact() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "tradespeople", TRADIE_UID), baselineTradie);
    await setDoc(doc(fs, ...CONTACT_PATH), {
      location: new GeoPoint(49.2827, -123.1207),
      primaryAddressText: "123 Real St, Vancouver, BC",
      businessAddress: null,
      businessPhone: null,
      gstNumber: null,
    });
  });
}

describe("tradespeople/{uid}/private/contact — owner+admin only", () => {
  it("owner can read their own contact subdoc", async () => {
    await seedContact();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, ...CONTACT_PATH)));
  });

  it("owner can write their own contact subdoc", async () => {
    await seedContact();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      setDoc(doc(fs, ...CONTACT_PATH), { primaryAddressText: "new" }, { merge: true }),
    );
  });

  it("an UNAUTHENTICATED reader cannot read the contact subdoc (the leak we closed)", async () => {
    await seedContact();
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(fs, ...CONTACT_PATH)));
  });

  it("a different tradesperson cannot read the contact subdoc", async () => {
    await seedContact();
    const fs = env.authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, ...CONTACT_PATH)));
  });

  it("admin can read the contact subdoc", async () => {
    await seedContact();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, ...CONTACT_PATH)));
  });
});
