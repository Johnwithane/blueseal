// disputes/{disputeId} — server-only writes; admin + parties read.
// Doc is mirrored from Stripe by the webhook dispatcher; clients should
// never write or delete one. Admin sees all; the tradesperson + client on
// the underlying invoice see their own.

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
  OTHER_CLIENT_UID,
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

const DISPUTE_ID = "dp_test_1";

async function seedDispute() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "disputes", DISPUTE_ID), {
      invoiceId: "inv_1",
      jobId: "job_1",
      tradespersonId: TRADIE_UID,
      clientId: CLIENT_UID,
      chargeId: "ch_1",
      paymentIntentId: "pi_1",
      amount: 50_000,
      currency: "CAD",
      reason: "fraudulent",
      status: "needs_response",
      outcome: null,
      evidenceDueBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
}

describe("disputes — read access", () => {
  it("admin can read any dispute", async () => {
    await seedDispute();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "disputes", DISPUTE_ID)));
  });

  it("involved tradesperson can read their own dispute", async () => {
    await seedDispute();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "disputes", DISPUTE_ID)));
  });

  it("involved client can read their own dispute", async () => {
    await seedDispute();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "disputes", DISPUTE_ID)));
  });

  it("unrelated tradesperson cannot read someone else's dispute", async () => {
    await seedDispute();
    const fs = env
      .authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS)
      .firestore();
    await assertFails(getDoc(doc(fs, "disputes", DISPUTE_ID)));
  });

  it("unrelated client cannot read someone else's dispute", async () => {
    await seedDispute();
    const fs = env
      .authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS)
      .firestore();
    await assertFails(getDoc(doc(fs, "disputes", DISPUTE_ID)));
  });
});

describe("disputes — write protection", () => {
  it("admin cannot create a dispute from the client side", async () => {
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "disputes", DISPUTE_ID), {
        invoiceId: "inv_x",
        chargeId: "ch_x",
      }),
    );
  });

  it("admin cannot update a dispute from the client side", async () => {
    await seedDispute();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "disputes", DISPUTE_ID), { outcome: "won" }),
    );
  });

  it("admin cannot delete a dispute from the client side", async () => {
    await seedDispute();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "disputes", DISPUTE_ID)));
  });
});
