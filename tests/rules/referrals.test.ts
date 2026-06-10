// referrals/{postId}_{fromUid}_{toUid} — job-board referrals between
// tradespeople. All writes flow through callables (sendJobReferral creates,
// submitApplication stamps appliedAt); client writes are denied outright.
// Reads are party-only (referrer, recipient, admin) — never public, since a
// referral reveals who's eyeing which job.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
  CLIENT_UID,
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

const POST_ID = "post1";
const REFERRAL_ID = `${POST_ID}_${TRADIE_UID}_${OTHER_TRADIE_UID}`;

function referralPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    postId: POST_ID,
    postTitle: "Replace furnace and a/c",
    postTrade: "electrical",
    postCity: "Kelowna",
    fromUserId: TRADIE_UID,
    fromDisplayName: "Tradie A",
    fromPhotoURL: null,
    fromPrimaryTrade: "plumbing",
    toUserId: OTHER_TRADIE_UID,
    toDisplayName: "Tradie B",
    toPhotoURL: null,
    message: "",
    createdAt: new Date(),
    appliedAt: null,
    ...overrides,
  };
}

async function seedReferral() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "referrals", REFERRAL_ID), referralPayload());
  });
}

describe("referrals — read access", () => {
  it("the referrer can read their referral", async () => {
    await seedReferral();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "referrals", REFERRAL_ID)));
  });

  it("the recipient can read a referral addressed to them", async () => {
    await seedReferral();
    const fs = env.authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "referrals", REFERRAL_ID)));
  });

  it("admin can read any referral", async () => {
    await seedReferral();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "referrals", REFERRAL_ID)));
  });

  it("an unrelated user cannot read a referral", async () => {
    await seedReferral();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "referrals", REFERRAL_ID)));
  });

  it("an unauthenticated user cannot read a referral", async () => {
    await seedReferral();
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(fs, "referrals", REFERRAL_ID)));
  });
});

describe("referrals — write protection", () => {
  it("a tradesperson cannot create a referral directly", async () => {
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "referrals", REFERRAL_ID), referralPayload()),
    );
  });

  it("the recipient cannot self-stamp appliedAt", async () => {
    await seedReferral();
    const fs = env.authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "referrals", REFERRAL_ID), { appliedAt: new Date() }),
    );
  });

  it("the referrer cannot delete their referral from the client side", async () => {
    await seedReferral();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "referrals", REFERRAL_ID)));
  });

  it("admin cannot update a referral from the client side", async () => {
    await seedReferral();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "referrals", REFERRAL_ID), { message: "edited" }),
    );
  });
});
