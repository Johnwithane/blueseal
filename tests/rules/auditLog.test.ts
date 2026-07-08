// auditLog/{entryId} — admin-only audit trail, written server-side only
// (Cloud Functions via the Admin SDK). No signed-in party other than admin
// may read, and no client SDK write is ever permitted, even for an admin.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
  CLIENT_UID,
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

const ENTRY_ID = "entry_1";

const entryDoc = {
  action: "adminSetUserDisabled",
  actorUid: ADMIN_UID,
  targetUid: TRADIE_UID,
  createdAt: new Date(),
};

async function seedEntry() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "auditLog", ENTRY_ID), entryDoc);
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

describe("auditLog/{entryId} — read (admin only)", () => {
  it("an admin can read an audit log entry", async () => {
    await seedEntry();
    await assertSucceeds(getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "auditLog", ENTRY_ID)));
  });

  it("a non-admin tradesperson cannot read an audit log entry, even about themselves", async () => {
    await seedEntry();
    await assertFails(getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "auditLog", ENTRY_ID)));
  });

  it("a client cannot read an audit log entry", async () => {
    await seedEntry();
    await assertFails(getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "auditLog", ENTRY_ID)));
  });
});

describe("auditLog/{entryId} — write is server-only", () => {
  it("not even an admin can create an audit log entry from the client SDK", async () => {
    await assertFails(addDoc(collection(fsAs(ADMIN_UID, ADMIN_CLAIMS), "auditLog"), entryDoc));
  });

  it("not even an admin can delete an audit log entry", async () => {
    await seedEntry();
    await assertFails(deleteDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "auditLog", ENTRY_ID)));
  });
});
