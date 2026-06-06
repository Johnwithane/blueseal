// Google Business reviews — rules coverage for the two surfaces the feature
// touches:
//   1. tradespeople/{uid}.googleReviews — server-managed snapshot; the owner
//      can't forge or clear it (only the google/* Cloud Functions write it).
//   2. tradespeople/{uid}/secure/google — the encrypted OAuth refresh token;
//      NO client (owner included) may read or write it. Server-only.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { GeoPoint, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

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

// Minimal approved-tradie doc — the /tradespeople update rule pins many fields
// via positive equality, so a real update needs the full baseline present.
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
  weeklyAvailability: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
  nextInvoiceNumber: 1,
  paymentInstructions: "",
  submittedAt: null,
  approvedAt: null,
};

const sampleSnapshot = {
  connected: true,
  locationName: "Bob's Plumbing",
  profileUrl: "https://maps.google.com/?cid=123",
  rating: 4.8,
  reviewCount: 42,
  reviews: [],
  lastSyncedAt: null,
  syncError: null,
};

async function seedTradie() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "tradespeople", TRADIE_UID), baselineTradie);
  });
}

describe("tradespeople.googleReviews — server-managed", () => {
  it("owner cannot self-set googleReviews", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { googleReviews: sampleSnapshot }),
    );
  });

  it("owner can update bio while googleReviews stays absent", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { bio: "I plumb superbly" }),
    );
  });

  it("admin can write googleReviews (stands in for the Cloud Function)", async () => {
    await seedTradie();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { googleReviews: sampleSnapshot }),
    );
  });
});

// tradespeople/{uid}/secure/google — the encrypted refresh token. Even the
// owner must not be able to pull their own OAuth credential into the browser.
const SECURE_PATH = ["tradespeople", TRADIE_UID, "secure", "google"] as const;

async function seedSecure() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...SECURE_PATH), {
      refreshTokenEnc: "iv.tag.ct",
      accountId: "123",
      locationId: "456",
    });
  });
}

describe("tradespeople/{uid}/secure — server-only", () => {
  it("owner cannot read their own secure credential doc", async () => {
    await seedSecure();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, ...SECURE_PATH)));
  });

  it("owner cannot write the secure credential doc", async () => {
    await seedSecure();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, ...SECURE_PATH), { refreshTokenEnc: "forged" }, { merge: true }),
    );
  });

  it("admin cannot read the secure credential doc", async () => {
    await seedSecure();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, ...SECURE_PATH)));
  });

  it("a different tradesperson cannot read the secure credential doc", async () => {
    await seedSecure();
    const fs = env.authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, ...SECURE_PATH)));
  });

  it("an unauthenticated reader cannot read the secure credential doc", async () => {
    await seedSecure();
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(fs, ...SECURE_PATH)));
  });
});
