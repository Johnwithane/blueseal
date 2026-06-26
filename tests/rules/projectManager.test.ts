// users/{uid}.projectManager server-managed lock: the owner can never write
// their own project-manager identity (recruiting code + liability + active flag);
// admin can. The owner CAN switch their active view into "projectManager" once
// they hold the role.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import { ADMIN_CLAIMS, ADMIN_UID, setupTestEnv } from "./setup";

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

const PM_UID = "pm-uid";
// A project manager: projectManager role rides in `roles`; primary `role` stays "client".
const PM_CLAIMS = { roles: ["client", "projectManager"], role: "client" };

function pmUserDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    roles: ["client", "projectManager"],
    activeRole: "client",
    displayName: "PM Person",
    projectManager: {
      referralCode: "ACME",
      active: true,
      liability: null,
      createdAt: new Date(),
    },
    ...overrides,
  };
}

async function seedPmUser() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", PM_UID), pmUserDoc());
  });
}

describe("users.projectManager — owner cannot write it", () => {
  it("the owner cannot change their own projectManager", async () => {
    await seedPmUser();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", PM_UID), { "projectManager.referralCode": "STOLEN" }),
    );
  });

  it("the owner cannot forge a signed liability", async () => {
    await seedPmUser();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", PM_UID), {
        "projectManager.liability": {
          version: "2026-06-25",
          signedAt: new Date(),
          signatureStoragePath: "forged",
        },
      }),
    );
  });

  it("the owner can still edit a free field without touching projectManager", async () => {
    await seedPmUser();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(fs, "users", PM_UID), { displayName: "New Name" }));
  });

  it("the owner can switch their active view into projectManager (role is held)", async () => {
    await seedPmUser();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(fs, "users", PM_UID), { activeRole: "projectManager" }));
  });

  it("an admin can write projectManager (e.g. deactivate a PM)", async () => {
    await seedPmUser();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(fs, "users", PM_UID), { "projectManager.active": false }));
  });

  it("the owner cannot self-attribute to a project manager (referredByPmId)", async () => {
    await seedPmUser();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "users", PM_UID), { referredByPmId: "some-pm" }));
  });
});

const PM_CODE_LOWER = "acme";

async function seedPmCode() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "pmReferralCodes", PM_CODE_LOWER), {
      uid: PM_UID,
      code: "ACME",
      claimedAt: new Date(),
    });
  });
}

describe("pmReferralCodes — read public, server-only writes", () => {
  it("is world-readable to an anonymous visitor (resolve /join?pm= at signup)", async () => {
    await seedPmCode();
    const fs = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(fs, "pmReferralCodes", PM_CODE_LOWER)));
  });

  it("the PM cannot create their own recruiting code directly (server-only)", async () => {
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "pmReferralCodes", PM_CODE_LOWER), {
        uid: PM_UID,
        code: "ACME",
        claimedAt: new Date(),
      }),
    );
  });
});
