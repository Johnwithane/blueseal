// qaChecklist/{itemId} — shared QA test-progress board. Read + mark by any QA
// tester (or admin); the writer is pinned to themselves; non-QA users are locked out.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { CLIENT_CLAIMS, CLIENT_UID, QA_CLAIMS, QA_UID, setupTestEnv } from "./setup";

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

const ITEM = "pm-money-path";

function entry(over: Record<string, unknown> = {}) {
  return { status: "pass", byUid: QA_UID, byName: "QA Tester", note: null, updatedAt: serverTimestamp(), ...over };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "qaChecklist", ITEM), { ...entry(), updatedAt: new Date() });
  });
}

describe("qaChecklist — QA-only shared board", () => {
  it("a QA tester can mark an item pass", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertSucceeds(setDoc(doc(fs, "qaChecklist", ITEM), entry({ status: "pass" })));
  });

  it("a QA tester can mark an item fail", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertSucceeds(setDoc(doc(fs, "qaChecklist", ITEM), entry({ status: "fail" })));
  });

  it("a QA tester can read the whole board", async () => {
    await seed();
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "qaChecklist", ITEM)));
  });

  it("a QA tester can clear (delete) an item", async () => {
    await seed();
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertSucceeds(deleteDoc(doc(fs, "qaChecklist", ITEM)));
  });

  it("cannot forge another writer (byUid pinned to self)", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(setDoc(doc(fs, "qaChecklist", ITEM), entry({ byUid: "someone-else" })));
  });

  it("rejects a status outside pass/fail", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(setDoc(doc(fs, "qaChecklist", ITEM), entry({ status: "maybe" })));
  });

  it("a non-QA client cannot read or write the board", async () => {
    await seed();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "qaChecklist", ITEM)));
    await assertFails(setDoc(doc(fs, "qaChecklist", ITEM), entry({ byUid: CLIENT_UID })));
  });
});
