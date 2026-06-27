// rosterInvites/{inviteId} — a PM's email invite to a tradesperson not yet on
// Blue Seal. The invitee's email lives on the doc, so read is owner-only (the
// inviting PM) + admin; ALL client writes are denied (sendRosterInvite /
// revokeRosterInvite / the unsubscribe endpoint write via the Admin SDK).

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
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

const PM_UID = "pm-uid";
const PM_CLAIMS = { roles: ["client", "projectManager"], role: "client" };
const INVITE_ID = "invite-1";

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

function inviteDoc(fs: ReturnType<typeof fsAs>) {
  return doc(fs, "rosterInvites", INVITE_ID);
}

async function seedInvite(overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "rosterInvites", INVITE_ID), {
      pmId: PM_UID,
      pmName: "Pat PM",
      inviteeName: "Sam Trade",
      emailLower: "sam@example.com",
      status: "pending_signup",
      tradieId: null,
      createdAt: new Date(),
      lastSentAt: new Date(),
      resendCount: 0,
      joinedAt: null,
      ...overrides,
    });
  });
}

describe("rosterInvites — owner-only reads", () => {
  it("the inviting PM can read their own invite", async () => {
    await seedInvite();
    await assertSucceeds(getDoc(inviteDoc(fsAs(PM_UID, PM_CLAIMS))));
  });

  it("admin can read any invite", async () => {
    await seedInvite();
    await assertSucceeds(getDoc(inviteDoc(fsAs(ADMIN_UID, ADMIN_CLAIMS))));
  });

  it("another signed-in user cannot read the invite", async () => {
    await seedInvite();
    await assertFails(getDoc(inviteDoc(fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS))));
  });

  it("the invited tradesperson cannot read the invite (email would leak)", async () => {
    await seedInvite();
    await assertFails(getDoc(inviteDoc(fsAs(TRADIE_UID, TRADIE_CLAIMS))));
  });

  it("an unauthenticated reader is denied", async () => {
    await seedInvite();
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "rosterInvites", INVITE_ID)));
  });
});

describe("rosterInvites — all client writes denied", () => {
  it("even the owning PM cannot create an invite directly", async () => {
    await assertFails(
      setDoc(inviteDoc(fsAs(PM_UID, PM_CLAIMS)), {
        pmId: PM_UID,
        status: "pending_signup",
        emailLower: "x@example.com",
      }),
    );
  });

  it("the owning PM cannot update their invite directly", async () => {
    await seedInvite();
    await assertFails(updateDoc(inviteDoc(fsAs(PM_UID, PM_CLAIMS)), { status: "revoked" }));
  });

  it("the owning PM cannot delete their invite directly", async () => {
    await seedInvite();
    await assertFails(deleteDoc(inviteDoc(fsAs(PM_UID, PM_CLAIMS))));
  });

  it("admin cannot write directly either (writes are Admin-SDK only)", async () => {
    await seedInvite();
    await assertFails(updateDoc(inviteDoc(fsAs(ADMIN_UID, ADMIN_CLAIMS)), { status: "revoked" }));
  });
});
