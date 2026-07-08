// idVerifications/{tradieId} — admin-only-plus-owner PII (ID document scan +
// review state). Doc id == the owning tradesperson's uid. Owner may
// create/replace while pending and withdraw a still-pending submission;
// once reviewed (approved/rejected) the doc is admin-only. This is the most
// sensitive collection in the vetting pipeline — a non-owner, non-admin
// signed-in user must never read another tradesperson's ID doc.

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

function pendingIdVerification(overrides: Record<string, unknown> = {}) {
  return {
    storagePath: `idVerifications/${TRADIE_UID}/doc.webp`,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

async function seedPending() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "idVerifications", TRADIE_UID), pendingIdVerification());
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

describe("idVerifications/{tradieId} — read (owner + admin only)", () => {
  it("the owning tradesperson can read their own ID verification", async () => {
    await seedPending();
    await assertSucceeds(getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID)));
  });

  it("an admin can read any tradesperson's ID verification", async () => {
    await seedPending();
    await assertSucceeds(getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "idVerifications", TRADIE_UID)));
  });

  it("a different signed-in tradesperson cannot read someone else's ID verification", async () => {
    await seedPending();
    await assertFails(
      getDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID)),
    );
  });

  it("a signed-in client cannot read a tradesperson's ID verification", async () => {
    await seedPending();
    await assertFails(getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "idVerifications", TRADIE_UID)));
  });
});

describe("idVerifications/{tradieId} — create", () => {
  it("the tradesperson can create their own pending submission", async () => {
    await assertSucceeds(
      setDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID), pendingIdVerification()),
    );
  });

  it("another tradesperson cannot create an ID verification doc under someone else's uid", async () => {
    await assertFails(
      setDoc(
        doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID),
        pendingIdVerification(),
      ),
    );
  });

  it("a client role cannot create an ID verification doc", async () => {
    await assertFails(
      setDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "idVerifications", CLIENT_UID), pendingIdVerification()),
    );
  });

  it("cannot create with a non-pending status or a pre-filled review", async () => {
    await assertFails(
      setDoc(
        doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID),
        pendingIdVerification({ status: "approved" }),
      ),
    );
    await assertFails(
      setDoc(
        doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID),
        pendingIdVerification({ reviewedBy: ADMIN_UID }),
      ),
    );
  });
});

describe("idVerifications/{tradieId} — update", () => {
  it("the owner can replace their still-pending submission", async () => {
    await seedPending();
    await assertSucceeds(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID), {
        storagePath: `idVerifications/${TRADIE_UID}/doc-v2.webp`,
      }),
    );
  });

  it("an admin can approve (flip status + stamp review fields)", async () => {
    await seedPending();
    await assertSucceeds(
      updateDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "idVerifications", TRADIE_UID), {
        status: "approved",
        reviewedBy: ADMIN_UID,
        reviewedAt: new Date(),
      }),
    );
  });

  it("the owner cannot self-approve their own ID verification", async () => {
    await seedPending();
    await assertFails(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID), {
        status: "approved",
      }),
    );
  });

  it("a different tradesperson cannot update someone else's ID verification", async () => {
    await seedPending();
    await assertFails(
      updateDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID), {
        storagePath: "hacked.webp",
      }),
    );
  });
});

describe("idVerifications/{tradieId} — delete", () => {
  it("the owner can withdraw a still-pending submission", async () => {
    await seedPending();
    await assertSucceeds(deleteDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID)));
  });

  it("the owner cannot delete an already-approved ID verification", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "idVerifications", TRADIE_UID),
        pendingIdVerification({ status: "approved", reviewedBy: ADMIN_UID, reviewedAt: new Date() }),
      );
    });
    await assertFails(deleteDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID)));
  });

  it("a different tradesperson cannot delete someone else's pending ID verification", async () => {
    await seedPending();
    await assertFails(
      deleteDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "idVerifications", TRADIE_UID)),
    );
  });
});
