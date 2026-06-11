// users/{uid}/savedTradies — the client's private shortlist of tradespeople.
// Owner-only in both directions: a tradesperson must never be able to learn
// who saved them, and nobody can write into someone else's list. Doc id is
// the saved tradesperson's uid; payload is only { createdAt }.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
  CLIENT_UID,
  OTHER_CLIENT_UID,
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

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

function savedDoc(fs: ReturnType<typeof fsAs>, ownerUid: string, tradieId: string) {
  return doc(fs, "users", ownerUid, "savedTradies", tradieId);
}

async function seedSaved() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", CLIENT_UID, "savedTradies", TRADIE_UID), {
      createdAt: new Date(),
    });
  });
}

describe("users/{uid}/savedTradies — owner-only shortlist", () => {
  it("owner can save a tradesperson", async () => {
    await assertSucceeds(
      setDoc(savedDoc(fsAs(CLIENT_UID, CLIENT_CLAIMS), CLIENT_UID, TRADIE_UID), {
        createdAt: new Date(),
      }),
    );
  });

  it("owner can list and un-save", async () => {
    await seedSaved();
    const fs = fsAs(CLIENT_UID, CLIENT_CLAIMS);
    await assertSucceeds(getDocs(collection(fs, "users", CLIENT_UID, "savedTradies")));
    await assertSucceeds(deleteDoc(savedDoc(fs, CLIENT_UID, TRADIE_UID)));
  });

  it("rejects extra fields beyond createdAt", async () => {
    await assertFails(
      setDoc(savedDoc(fsAs(CLIENT_UID, CLIENT_CLAIMS), CLIENT_UID, TRADIE_UID), {
        createdAt: new Date(),
        note: "great plumber",
      }),
    );
  });

  it("another user cannot read or write someone else's list", async () => {
    await seedSaved();
    const other = fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS);
    await assertFails(getDoc(savedDoc(other, CLIENT_UID, TRADIE_UID)));
    await assertFails(
      setDoc(savedDoc(other, CLIENT_UID, "someone-else"), { createdAt: new Date() }),
    );
  });

  it("the saved tradesperson cannot see who saved them", async () => {
    await seedSaved();
    const tradie = fsAs(TRADIE_UID, TRADIE_CLAIMS);
    await assertFails(getDoc(savedDoc(tradie, CLIENT_UID, TRADIE_UID)));
    await assertFails(getDocs(collection(tradie, "users", CLIENT_UID, "savedTradies")));
  });

  it("admin can read", async () => {
    await seedSaved();
    await assertSucceeds(
      getDoc(savedDoc(fsAs(ADMIN_UID, ADMIN_CLAIMS), CLIENT_UID, TRADIE_UID)),
    );
  });
});
