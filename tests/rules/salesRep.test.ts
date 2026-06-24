// referralCodes/{codeLower} — vanity-code registry (world-read, server-only
// write) — and the users/{uid}.salesRep server-managed lock (owner can never
// write their own rep identity; admin can).

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
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

const REP_UID = "rep-uid";
// A sales rep: sales role rides in `roles`; legacy primary `role` stays "client".
const REP_CLAIMS = { roles: ["client", "sales"], role: "client" };

function repUserDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    roles: ["client", "sales"],
    activeRole: "client",
    displayName: "Rep Person",
    salesRep: {
      referralCode: "JOHNNYK",
      active: true,
      liability: {
        version: "2026-06-24",
        signedAt: new Date(),
        signatureStoragePath: "users/rep-uid/signatures/sales-agreement.webp",
      },
      createdAt: new Date(),
    },
    ...overrides,
  };
}

async function seedRepUser() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", REP_UID), repUserDoc());
  });
}

async function seedCode(codeLower = "johnnyk") {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "referralCodes", codeLower), {
      uid: REP_UID,
      code: codeLower.toUpperCase(),
      claimedAt: new Date(),
    });
  });
}

describe("referralCodes — read public, server-only writes", () => {
  it("is world-readable to an anonymous visitor (resolve ?ref= at signup)", async () => {
    await seedCode();
    const fs = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(fs, "referralCodes", "johnnyk")));
  });

  it("is readable by a signed-in client", async () => {
    await seedCode();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "referralCodes", "johnnyk")));
  });

  it("an admin cannot create one directly (server-only)", async () => {
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "referralCodes", "johnnyk"), {
        uid: ADMIN_UID,
        code: "JOHNNYK",
        claimedAt: new Date(),
      }),
    );
  });

  it("the rep cannot create their own code directly", async () => {
    const fs = env.authenticatedContext(REP_UID, REP_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "referralCodes", "johnnyk"), {
        uid: REP_UID,
        code: "JOHNNYK",
        claimedAt: new Date(),
      }),
    );
  });
});

describe("users.salesRep — owner cannot write it", () => {
  it("the owner cannot change their own salesRep", async () => {
    await seedRepUser();
    const fs = env.authenticatedContext(REP_UID, REP_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "users", REP_UID), { "salesRep.referralCode": "STOLEN" }));
  });

  it("the owner can still edit a free field without touching salesRep", async () => {
    await seedRepUser();
    const fs = env.authenticatedContext(REP_UID, REP_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(fs, "users", REP_UID), { displayName: "New Name" }));
  });

  it("an admin can write salesRep (e.g. deactivate a rep)", async () => {
    await seedRepUser();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(fs, "users", REP_UID), { "salesRep.active": false }));
  });
});
