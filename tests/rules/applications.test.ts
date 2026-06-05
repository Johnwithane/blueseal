// jobPosts/{postId}/applications/{tradieId} — read access for the
// bid-marketplace flow. The application now embeds a full itemized `quote`, so
// the locking invariant is: the post-owning client can read each application
// (and therefore the embedded quote it compares + accepts), the applicant can
// read their own, and no other tradesperson/client can read it. Writes are
// callable-only (submitApplication / acceptApplicationQuote use the admin SDK).

import { afterAll, beforeAll, beforeEach, describe, it, expect } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
  CLIENT_UID,
  OTHER_CLIENT_UID,
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

const POST_ID = "post_1";
const APP_PATH = ["jobPosts", POST_ID, "applications", TRADIE_UID] as const;

const baselineApplication = {
  tradespersonId: TRADIE_UID,
  postId: POST_ID,
  clientId: CLIENT_UID,
  status: "pending",
  message: "I can help with this — here's my plan and what's included.",
  // Server-derived one-line summary.
  proposedPrice: { type: "fixed", amount: 113_000 },
  // Full itemized quote the client compares + accepts.
  quote: {
    lineItems: [
      { kind: "labour", description: "Labour", quantity: 1, unitPrice: 100_000, taxRate: 0.13 },
    ],
    subtotal: 100_000,
    discount: null,
    discountAmount: 0,
    taxTotal: 13_000,
    total: 113_000,
    currency: "CAD",
    upfrontFee: null,
    estimatedHours: null,
    validUntil: null,
    terms: "",
    noteToClient: "",
  },
  proposedStartDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function seedApplication() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...APP_PATH), baselineApplication);
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

describe("applications — read access (bid marketplace)", () => {
  it("the post-owning client can read an application incl. its embedded quote", async () => {
    await seedApplication();
    const snap = await assertSucceeds(
      getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), ...APP_PATH)),
    );
    // The quote the client accepts must be readable on the application doc.
    expect(snap.data()?.quote?.total).toBe(113_000);
  });

  it("the applicant can read their own application", async () => {
    await seedApplication();
    await assertSucceeds(getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), ...APP_PATH)));
  });

  it("an admin can read any application", async () => {
    await seedApplication();
    await assertSucceeds(getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), ...APP_PATH)));
  });

  it("a different tradesperson cannot read someone else's application (bid-blind)", async () => {
    await seedApplication();
    await assertFails(getDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), ...APP_PATH)));
  });

  it("a different client cannot read another client's applicant", async () => {
    await seedApplication();
    await assertFails(getDoc(doc(fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS), ...APP_PATH)));
  });
});

describe("applications — writes are callable-only", () => {
  it("a tradesperson cannot create an application by direct write", async () => {
    await assertFails(
      setDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), ...APP_PATH), baselineApplication),
    );
  });

  it("the applicant cannot edit their own application (incl. the quote)", async () => {
    await seedApplication();
    await assertFails(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), ...APP_PATH), {
        "quote.total": 1,
      }),
    );
  });

  it("the client cannot flip an application to selected by direct write", async () => {
    await seedApplication();
    await assertFails(
      updateDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), ...APP_PATH), { status: "selected" }),
    );
  });
});
