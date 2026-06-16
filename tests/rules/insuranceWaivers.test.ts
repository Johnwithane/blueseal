// insuranceWaivers/{jobId} — read-only server-written record that a job is
// proceeding with an uninsured tradesperson. Written exclusively via the admin
// SDK (clientAcceptQuote / acceptApplicationQuote / signUninsuredWaiver) so
// ALL client-side writes are denied, including from the named parties.
//
// The resource == null short-circuit mirrors quotes/reviewPairs/invoices: the
// job-detail view probes insuranceWaivers/{jobId} on mount (treating missing as
// "no waiver needed") so a party reading a non-existent doc must get a clean
// empty result, not a permission-denied.

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

// The waiver doc id IS the jobId (same deterministic pattern as quotes/invoices).
const JOB_ID = "job_waiver_1";

const baselineWaiver = {
  jobId: JOB_ID,
  clientId: CLIENT_UID,
  tradespersonId: TRADIE_UID,
  disclosureVersion: "1.0",
  reason: "tradesperson_uninsured",
  client: {
    uid: CLIENT_UID,
    displayName: "Test Client",
    signedAt: null,
  },
  tradesperson: {
    uid: TRADIE_UID,
    displayName: "Test Tradesperson",
    signedAt: null,
  },
  createdAt: null,
  updatedAt: null,
};

async function seedWaiver(overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "insuranceWaivers", JOB_ID), {
      ...baselineWaiver,
      ...overrides,
    });
  });
}

function asClient() {
  return env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
}
function asTradie() {
  return env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
}
function asAdmin() {
  return env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
}

// ---------------------------------------------------------------------------
// READ — allow cases
// ---------------------------------------------------------------------------
describe("insuranceWaivers — read: parties and admin are allowed", () => {
  it("the job's client (clientId) can read the waiver", async () => {
    await seedWaiver();
    await assertSucceeds(getDoc(doc(asClient(), "insuranceWaivers", JOB_ID)));
  });

  it("the job's tradesperson (tradespersonId) can read the waiver", async () => {
    await seedWaiver();
    await assertSucceeds(getDoc(doc(asTradie(), "insuranceWaivers", JOB_ID)));
  });

  it("an admin can read any waiver", async () => {
    await seedWaiver();
    await assertSucceeds(getDoc(doc(asAdmin(), "insuranceWaivers", JOB_ID)));
  });
});

// ---------------------------------------------------------------------------
// READ — resource == null probe (the "no waiver yet" case)
// ---------------------------------------------------------------------------
describe("insuranceWaivers — resource == null probe", () => {
  it("a signed-in client reading a NON-existent waiver doc succeeds (no waiver = no problem)", async () => {
    // Do NOT seed the doc — the key should not exist in Firestore.
    await assertSucceeds(
      getDoc(doc(asClient(), "insuranceWaivers", "does-not-exist")),
    );
  });

  it("a signed-in tradesperson reading a NON-existent waiver doc succeeds", async () => {
    await assertSucceeds(
      getDoc(doc(asTradie(), "insuranceWaivers", "does-not-exist")),
    );
  });

  it("a signed-in admin reading a NON-existent waiver doc succeeds", async () => {
    await assertSucceeds(
      getDoc(doc(asAdmin(), "insuranceWaivers", "does-not-exist")),
    );
  });
});

// ---------------------------------------------------------------------------
// READ — deny cases
// ---------------------------------------------------------------------------
describe("insuranceWaivers — read: third parties are denied", () => {
  it("a signed-in third-party client (not the job's client) cannot read the waiver", async () => {
    await seedWaiver();
    const fs = env
      .authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS)
      .firestore();
    await assertFails(getDoc(doc(fs, "insuranceWaivers", JOB_ID)));
  });

  it("a signed-in third-party tradesperson (not the job's tradie) cannot read the waiver", async () => {
    await seedWaiver();
    const fs = env
      .authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS)
      .firestore();
    await assertFails(getDoc(doc(fs, "insuranceWaivers", JOB_ID)));
  });

  it("an unauthenticated user cannot read the waiver", async () => {
    await seedWaiver();
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(fs, "insuranceWaivers", JOB_ID)));
  });
});

// ---------------------------------------------------------------------------
// WRITE — all client-side writes are denied (server/admin SDK only)
// ---------------------------------------------------------------------------
describe("insuranceWaivers — write: all client writes are denied (server-only collection)", () => {
  it("the job's client cannot CREATE a waiver doc directly", async () => {
    await assertFails(
      setDoc(doc(asClient(), "insuranceWaivers", JOB_ID), baselineWaiver),
    );
  });

  it("the job's tradesperson cannot CREATE a waiver doc directly", async () => {
    await assertFails(
      setDoc(doc(asTradie(), "insuranceWaivers", JOB_ID), baselineWaiver),
    );
  });

  it("the job's client cannot UPDATE the waiver doc", async () => {
    await seedWaiver();
    await assertFails(
      updateDoc(doc(asClient(), "insuranceWaivers", JOB_ID), {
        "client.signedAt": new Date(),
      }),
    );
  });

  it("the job's tradesperson cannot UPDATE the waiver doc", async () => {
    await seedWaiver();
    await assertFails(
      updateDoc(doc(asTradie(), "insuranceWaivers", JOB_ID), {
        "tradesperson.signedAt": new Date(),
      }),
    );
  });

  it("the job's client cannot DELETE the waiver doc", async () => {
    await seedWaiver();
    await assertFails(deleteDoc(doc(asClient(), "insuranceWaivers", JOB_ID)));
  });

  it("the job's tradesperson cannot DELETE the waiver doc", async () => {
    await seedWaiver();
    await assertFails(deleteDoc(doc(asTradie(), "insuranceWaivers", JOB_ID)));
  });
});
