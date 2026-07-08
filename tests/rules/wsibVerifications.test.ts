// wsibVerifications/{tradieId} — provincial workers'-comp clearance proof +
// review state. Same shape as insuranceVerifications: owner may
// create/replace while pending; delete is admin-only (no owner-withdraw
// path). Read of another tradesperson's WSIB doc by a signed-in non-owner
// non-admin must be denied.

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

function pendingWsib(overrides: Record<string, unknown> = {}) {
  return {
    storagePath: `wsibVerifications/${TRADIE_UID}/doc.webp`,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

async function seedPending() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "wsibVerifications", TRADIE_UID), pendingWsib());
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

describe("wsibVerifications/{tradieId} — read (owner + admin only)", () => {
  it("the owning tradesperson can read their own WSIB verification", async () => {
    await seedPending();
    await assertSucceeds(getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "wsibVerifications", TRADIE_UID)));
  });

  it("an admin can read any tradesperson's WSIB verification", async () => {
    await seedPending();
    await assertSucceeds(getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "wsibVerifications", TRADIE_UID)));
  });

  it("a different signed-in tradesperson cannot read someone else's WSIB verification", async () => {
    await seedPending();
    await assertFails(
      getDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "wsibVerifications", TRADIE_UID)),
    );
  });

  it("a client cannot read a tradesperson's WSIB verification", async () => {
    await seedPending();
    await assertFails(getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "wsibVerifications", TRADIE_UID)));
  });
});

describe("wsibVerifications/{tradieId} — create", () => {
  it("the tradesperson can create their own pending submission", async () => {
    await assertSucceeds(
      setDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "wsibVerifications", TRADIE_UID), pendingWsib()),
    );
  });

  it("another tradesperson cannot create a WSIB doc under someone else's uid", async () => {
    await assertFails(
      setDoc(
        doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "wsibVerifications", TRADIE_UID),
        pendingWsib(),
      ),
    );
  });

  it("cannot create with a non-pending status or a pre-filled review", async () => {
    await assertFails(
      setDoc(
        doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "wsibVerifications", TRADIE_UID),
        pendingWsib({ status: "approved" }),
      ),
    );
  });
});

describe("wsibVerifications/{tradieId} — update", () => {
  it("the owner can replace their still-pending submission", async () => {
    await seedPending();
    await assertSucceeds(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "wsibVerifications", TRADIE_UID), {
        storagePath: `wsibVerifications/${TRADIE_UID}/doc-v2.webp`,
      }),
    );
  });

  it("an admin can approve (flip status + stamp review fields)", async () => {
    await seedPending();
    await assertSucceeds(
      updateDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "wsibVerifications", TRADIE_UID), {
        status: "approved",
        reviewedBy: ADMIN_UID,
        reviewedAt: new Date(),
      }),
    );
  });

  it("the owner cannot self-approve their own WSIB verification", async () => {
    await seedPending();
    await assertFails(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "wsibVerifications", TRADIE_UID), {
        status: "approved",
      }),
    );
  });
});

describe("wsibVerifications/{tradieId} — delete (admin only)", () => {
  it("an admin can delete a WSIB verification", async () => {
    await seedPending();
    await assertSucceeds(deleteDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "wsibVerifications", TRADIE_UID)));
  });

  it("the owner cannot delete their own WSIB verification (no owner-withdraw path)", async () => {
    await seedPending();
    await assertFails(deleteDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "wsibVerifications", TRADIE_UID)));
  });
});
