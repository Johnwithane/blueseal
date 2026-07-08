// certifications/{certId} — a tradesperson's trade-cert uploads (PII/proof
// document + review state). Doc id is an auto id; ownership is carried on
// the tradespersonId field. Owner may create/replace while pending and
// withdraw a still-pending cert; once reviewed (approved/rejected) it's
// admin-only. Read of another tradesperson's cert by a signed-in non-owner
// non-admin must be denied — that's the sensitive case here.

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

const CERT_ID = "cert_1";

function pendingCert(overrides: Record<string, unknown> = {}) {
  return {
    tradespersonId: TRADIE_UID,
    trade: "electrician",
    storagePath: `certifications/${TRADIE_UID}/${CERT_ID}.webp`,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

async function seedPending() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "certifications", CERT_ID), pendingCert());
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

describe("certifications/{certId} — read (owner + admin only)", () => {
  it("the owning tradesperson can read their own certification", async () => {
    await seedPending();
    await assertSucceeds(getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID)));
  });

  it("an admin can read any tradesperson's certification", async () => {
    await seedPending();
    await assertSucceeds(getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "certifications", CERT_ID)));
  });

  it("a different signed-in tradesperson cannot read someone else's certification", async () => {
    await seedPending();
    await assertFails(getDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID)));
  });

  it("a client cannot read a tradesperson's certification", async () => {
    await seedPending();
    await assertFails(getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "certifications", CERT_ID)));
  });
});

describe("certifications/{certId} — create", () => {
  it("the tradesperson can create their own pending certification", async () => {
    await assertSucceeds(
      setDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID), pendingCert()),
    );
  });

  it("a tradesperson cannot create a certification under someone else's tradespersonId", async () => {
    await assertFails(
      setDoc(
        doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID),
        pendingCert({ tradespersonId: TRADIE_UID }),
      ),
    );
  });

  it("a client cannot create a certification", async () => {
    await assertFails(
      setDoc(
        doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "certifications", CERT_ID),
        pendingCert({ tradespersonId: CLIENT_UID }),
      ),
    );
  });

  it("cannot create with a non-pending status or a pre-filled review", async () => {
    await assertFails(
      setDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID), pendingCert({ status: "approved" })),
    );
    await assertFails(
      setDoc(
        doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID),
        pendingCert({ rejectionReason: "bad scan" }),
      ),
    );
  });
});

describe("certifications/{certId} — update", () => {
  it("the owner can replace their still-pending certification", async () => {
    await seedPending();
    await assertSucceeds(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID), {
        storagePath: `certifications/${TRADIE_UID}/${CERT_ID}-v2.webp`,
      }),
    );
  });

  it("an admin can approve (flip status + stamp review fields)", async () => {
    await seedPending();
    await assertSucceeds(
      updateDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "certifications", CERT_ID), {
        status: "approved",
        reviewedBy: ADMIN_UID,
        reviewedAt: new Date(),
      }),
    );
  });

  it("the owner cannot self-approve their own certification", async () => {
    await seedPending();
    await assertFails(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID), { status: "approved" }),
    );
  });

  it("a different tradesperson cannot update someone else's certification", async () => {
    await seedPending();
    await assertFails(
      updateDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID), {
        storagePath: "hacked.webp",
      }),
    );
  });
});

describe("certifications/{certId} — delete", () => {
  it("the owner can withdraw a still-pending certification", async () => {
    await seedPending();
    await assertSucceeds(deleteDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID)));
  });

  it("the owner cannot delete an already-approved certification", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "certifications", CERT_ID),
        pendingCert({ status: "approved", reviewedBy: ADMIN_UID, reviewedAt: new Date() }),
      );
    });
    await assertFails(deleteDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID)));
  });

  it("a different tradesperson cannot delete someone else's pending certification", async () => {
    await seedPending();
    await assertFails(deleteDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "certifications", CERT_ID)));
  });
});
