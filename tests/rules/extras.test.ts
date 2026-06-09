// jobs/{jobId}/extras — "change orders". BOTH job parties + admin can READ
// (the client must see + decide; the tradie tracks status). All party WRITES
// are denied: the proposeExtra / respondExtra / cancelExtra callables run with
// the admin SDK (bypassing rules), so approval state can't be forged by either
// side. These tests pin read-for-parties + write-callable-only, and the
// billingType-immutability on the parent job doc.

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

const JOB_ID = "job_1";
const EXTRA_ID = "co_1";

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "jobs", JOB_ID), {
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      chatId: "chat_1",
      createdAt: new Date(),
      trade: "plumber",
      status: "in_progress",
      billingType: "fixed",
    });
    await setDoc(doc(fs, "jobs", JOB_ID, "extras", EXTRA_ID), {
      tradespersonId: TRADIE_UID,
      clientId: CLIENT_UID,
      description: "Replace shut-off valve",
      billingType: "hourly",
      flatAmountCents: null,
      hourlyRateCents: 9000,
      status: "proposed",
      proposedAt: new Date(),
      decidedAt: null,
      declinedReason: null,
      invoicedAt: null,
      createdAt: new Date(),
    });
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

const extraRef = (fs: ReturnType<typeof fsAs>) => doc(fs, "jobs", JOB_ID, "extras", EXTRA_ID);

describe("jobs/{jobId}/extras — read access", () => {
  it("the assigned tradesperson can read a change order", async () => {
    await seed();
    await assertSucceeds(getDoc(extraRef(fsAs(TRADIE_UID, TRADIE_CLAIMS))));
  });

  it("the client can read a change order on their job", async () => {
    await seed();
    await assertSucceeds(getDoc(extraRef(fsAs(CLIENT_UID, CLIENT_CLAIMS))));
  });

  it("an admin can read a change order", async () => {
    await seed();
    await assertSucceeds(getDoc(extraRef(fsAs(ADMIN_UID, ADMIN_CLAIMS))));
  });

  it("an unrelated client cannot read a change order", async () => {
    await seed();
    await assertFails(getDoc(extraRef(fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS))));
  });
});

describe("jobs/{jobId}/extras — writes are callable-only", () => {
  const validExtra = {
    tradespersonId: TRADIE_UID,
    clientId: CLIENT_UID,
    description: "Extra outlet",
    billingType: "flat",
    flatAmountCents: 5000,
    hourlyRateCents: null,
    status: "proposed",
    proposedAt: new Date(),
    decidedAt: null,
    declinedReason: null,
    invoicedAt: null,
    createdAt: new Date(),
  };

  it("the tradesperson cannot create a change order directly", async () => {
    await seed();
    await assertFails(
      setDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "jobs", JOB_ID, "extras", "co_2"), validExtra),
    );
  });

  it("the client cannot self-approve a proposed change order", async () => {
    await seed();
    await assertFails(
      updateDoc(extraRef(fsAs(CLIENT_UID, CLIENT_CLAIMS)), { status: "approved" }),
    );
  });

  it("the tradesperson cannot flip a change order to approved", async () => {
    await seed();
    await assertFails(
      updateDoc(extraRef(fsAs(TRADIE_UID, TRADIE_CLAIMS)), { status: "approved" }),
    );
  });
});

describe("jobs/{jobId} — billingType is immutable to parties", () => {
  it("the client cannot change billingType on their job", async () => {
    await seed();
    await assertFails(
      updateDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "jobs", JOB_ID), { billingType: "hourly" }),
    );
  });

  it("the tradesperson cannot change billingType on their job", async () => {
    await seed();
    await assertFails(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "jobs", JOB_ID), { billingType: "hourly" }),
    );
  });
});
