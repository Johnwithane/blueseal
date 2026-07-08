// insuranceVerifications/{tradieId} — general-liability proof upload +
// review state. Doc id == the owning tradesperson's uid. Owner may
// create/replace while pending; once reviewed, only an admin may touch it
// (unlike idVerifications/certifications, delete here is admin-only —
// there's no owner-withdraw path). Read of another tradesperson's insurance
// doc by a signed-in non-owner non-admin must be denied.

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

function pendingInsurance(overrides: Record<string, unknown> = {}) {
  return {
    storagePath: `insuranceVerifications/${TRADIE_UID}/doc.webp`,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

async function seedPending() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "insuranceVerifications", TRADIE_UID), pendingInsurance());
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

describe("insuranceVerifications/{tradieId} — read (owner + admin only)", () => {
  it("the owning tradesperson can read their own insurance verification", async () => {
    await seedPending();
    await assertSucceeds(
      getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "insuranceVerifications", TRADIE_UID)),
    );
  });

  it("an admin can read any tradesperson's insurance verification", async () => {
    await seedPending();
    await assertSucceeds(
      getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "insuranceVerifications", TRADIE_UID)),
    );
  });

  it("a different signed-in tradesperson cannot read someone else's insurance verification", async () => {
    await seedPending();
    await assertFails(
      getDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "insuranceVerifications", TRADIE_UID)),
    );
  });

  it("a client cannot read a tradesperson's insurance verification", async () => {
    await seedPending();
    await assertFails(
      getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "insuranceVerifications", TRADIE_UID)),
    );
  });
});

describe("insuranceVerifications/{tradieId} — create", () => {
  it("the tradesperson can create their own pending submission", async () => {
    await assertSucceeds(
      setDoc(
        doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "insuranceVerifications", TRADIE_UID),
        pendingInsurance(),
      ),
    );
  });

  it("another tradesperson cannot create an insurance doc under someone else's uid", async () => {
    await assertFails(
      setDoc(
        doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "insuranceVerifications", TRADIE_UID),
        pendingInsurance(),
      ),
    );
  });

  it("cannot create with a non-pending status or a pre-filled review", async () => {
    await assertFails(
      setDoc(
        doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "insuranceVerifications", TRADIE_UID),
        pendingInsurance({ status: "approved" }),
      ),
    );
  });
});

describe("insuranceVerifications/{tradieId} — update", () => {
  it("the owner can replace their still-pending submission", async () => {
    await seedPending();
    await assertSucceeds(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "insuranceVerifications", TRADIE_UID), {
        storagePath: `insuranceVerifications/${TRADIE_UID}/doc-v2.webp`,
      }),
    );
  });

  it("an admin can approve (flip status + stamp review fields)", async () => {
    await seedPending();
    await assertSucceeds(
      updateDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "insuranceVerifications", TRADIE_UID), {
        status: "approved",
        reviewedBy: ADMIN_UID,
        reviewedAt: new Date(),
      }),
    );
  });

  it("the owner cannot self-approve their own insurance verification", async () => {
    await seedPending();
    await assertFails(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "insuranceVerifications", TRADIE_UID), {
        status: "approved",
      }),
    );
  });
});

describe("insuranceVerifications/{tradieId} — delete (admin only)", () => {
  it("an admin can delete an insurance verification", async () => {
    await seedPending();
    await assertSucceeds(
      deleteDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "insuranceVerifications", TRADIE_UID)),
    );
  });

  it("the owner cannot delete their own insurance verification (no owner-withdraw path)", async () => {
    await seedPending();
    await assertFails(
      deleteDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "insuranceVerifications", TRADIE_UID)),
    );
  });
});
