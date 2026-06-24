// tradespeople/{uid} sales attribution (regionId / referredByRepId /
// referralSignal) is server-managed (stamped by submitForVetting). The owner can
// never set it at create or change it on update; admin can (manual override).

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";

import { ADMIN_CLAIMS, ADMIN_UID, TRADIE_CLAIMS, TRADIE_UID, setupTestEnv } from "./setup";

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

function tradieDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    displayName: "Tess Tradie",
    photoURL: null,
    verifiedTrades: [],
    idVerified: false,
    isVisible: false,
    ratingAvg: 0,
    ratingCount: 0,
    ratingDimensions: {
      quality: { avg: 0, count: 0 },
      punctuality: { avg: 0, count: 0 },
      communication: { avg: 0, count: 0 },
      value: { avg: 0, count: 0 },
    },
    nextInvoiceNumber: 1,
    approvedAt: null,
    vettingStatus: "draft",
    bio: "",
    ...overrides,
  };
}

async function seedDraft(overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "tradespeople", TRADIE_UID), tradieDraft(overrides));
  });
}

describe("tradespeople sales attribution — owner-locked", () => {
  it("the owner cannot set regionId on their own profile", async () => {
    await seedDraft();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "tradespeople", TRADIE_UID), { regionId: "region-x" }));
  });

  it("the owner cannot self-attribute referredByRepId", async () => {
    await seedDraft();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "tradespeople", TRADIE_UID), { referredByRepId: "rep-x" }));
  });

  it("the owner can still edit a free field (bio) without touching attribution", async () => {
    await seedDraft();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "tradespeople", TRADIE_UID), { bio: "Licensed electrician." }),
    );
  });

  it("an admin can set regionId (manual override for a missed/wrong match)", async () => {
    await seedDraft();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(fs, "tradespeople", TRADIE_UID), { regionId: "region-x" }));
  });

  it("the owner cannot create a draft pre-attributed to a rep", async () => {
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "tradespeople", TRADIE_UID), tradieDraft({ referredByRepId: "rep-x" })),
    );
  });

  it("the owner can create a normal draft (no attribution)", async () => {
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(setDoc(doc(fs, "tradespeople", TRADIE_UID), tradieDraft()));
  });
});
