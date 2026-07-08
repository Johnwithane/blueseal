// aiUsage/{usageId} — per-request AI usage/cost record, written server-side
// only (the AI callable dispatcher via the Admin SDK). Owner (userId) + admin
// read; nobody, including admin, may write from the client SDK.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { addDoc, collection, doc, getDoc, setDoc } from "firebase/firestore";

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

const USAGE_ID = "usage_1";

const usageDoc = {
  userId: TRADIE_UID,
  feature: "aiChat",
  tokensIn: 120,
  tokensOut: 340,
  costCents: 2,
  createdAt: new Date(),
};

async function seedUsage() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "aiUsage", USAGE_ID), usageDoc);
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

describe("aiUsage/{usageId} — read (owner + admin only)", () => {
  it("the owning user can read their own usage record", async () => {
    await seedUsage();
    await assertSucceeds(getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "aiUsage", USAGE_ID)));
  });

  it("an admin can read any usage record", async () => {
    await seedUsage();
    await assertSucceeds(getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "aiUsage", USAGE_ID)));
  });

  it("a different user cannot read someone else's usage record", async () => {
    await seedUsage();
    await assertFails(getDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "aiUsage", USAGE_ID)));
  });

  it("a client cannot read a tradesperson's usage record", async () => {
    await seedUsage();
    await assertFails(getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "aiUsage", USAGE_ID)));
  });
});

describe("aiUsage/{usageId} — write is server-only", () => {
  it("the owning user cannot create their own usage record from the client", async () => {
    await assertFails(
      setDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "aiUsage", USAGE_ID), usageDoc),
    );
  });

  it("not even an admin can create a usage record from the client SDK", async () => {
    await assertFails(addDoc(collection(fsAs(ADMIN_UID, ADMIN_CLAIMS), "aiUsage"), usageDoc));
  });
});
