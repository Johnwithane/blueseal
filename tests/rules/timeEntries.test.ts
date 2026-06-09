// jobs/{jobId}/timeEntries — BOTH job parties (client + tradesperson) plus
// admin can read the clock sessions; the client watches live clocked time on
// the Schedule tab so the eventual invoice is unsurprising. The read rule must
// authorize a LIST query from EITHER party. The client's list filters by
// tradespersonId (to stay robust to a swapped tradie), so a read rule keyed on
// resource.data.clientId == uid() can't statically authorize it ("rules are
// not filters") — the rule must authorize via the parent job, not a per-doc
// field. These tests pin that.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, orderBy, query, setDoc, where } from "firebase/firestore";

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

import { collectionGroup } from "firebase/firestore";

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

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "jobs", JOB_ID), {
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      status: "in_progress",
    });
    await setDoc(doc(fs, "jobs", JOB_ID, "timeEntries", "e1"), {
      tradespersonId: TRADIE_UID,
      clientId: CLIENT_UID,
      startedAt: new Date(),
      endedAt: null,
      hourlyRateSnapshot: 10000,
      source: "clock",
      invoicedAt: null,
    });
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

// Mirrors subscribeJobTimeEntries: filter on tradespersonId + orderBy startedAt.
function entriesQuery(fs: ReturnType<typeof fsAs>) {
  return query(
    collection(fs, "jobs", JOB_ID, "timeEntries"),
    where("tradespersonId", "==", TRADIE_UID),
    orderBy("startedAt", "asc"),
  );
}

describe("jobs/{jobId}/timeEntries — read access for both parties", () => {
  it("the assigned tradesperson can list time entries", async () => {
    await seed();
    await assertSucceeds(getDocs(entriesQuery(fsAs(TRADIE_UID, TRADIE_CLAIMS))));
  });

  it("the client can list time entries for their job (live clocked time)", async () => {
    await seed();
    await assertSucceeds(getDocs(entriesQuery(fsAs(CLIENT_UID, CLIENT_CLAIMS))));
  });

  it("an admin can list time entries", async () => {
    await seed();
    await assertSucceeds(getDocs(entriesQuery(fsAs(ADMIN_UID, ADMIN_CLAIMS))));
  });

  it("a stranger (unrelated client) cannot list time entries", async () => {
    await seed();
    await assertFails(getDocs(entriesQuery(fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS))));
  });
});

// Mirrors useActiveClock: collectionGroup('timeEntries') for the tradie's one
// running session across ALL jobs. This is authorized by the recursive-wildcard
// rule (match /{path=**}/timeEntries), NOT the nested per-job rule, so it needs
// its own coverage. The query filters tradespersonId == <uid> && endedAt == null;
// the rule enforces resource.data.tradespersonId == uid(), so a query scoped to
// someone else's id is rejected up-front ("rules are not filters").
function activeClockQuery(fs: ReturnType<typeof fsAs>, tradieUid: string) {
  return query(
    collectionGroup(fs, "timeEntries"),
    where("tradespersonId", "==", tradieUid),
    where("endedAt", "==", null),
  );
}

describe("timeEntries — collection-group read (the live-clock listener)", () => {
  it("a tradesperson can list their own running session across all jobs", async () => {
    await seed();
    await assertSucceeds(
      getDocs(activeClockQuery(fsAs(TRADIE_UID, TRADIE_CLAIMS), TRADIE_UID)),
    );
  });

  it("an admin can list a tradesperson's running sessions", async () => {
    await seed();
    await assertSucceeds(
      getDocs(activeClockQuery(fsAs(ADMIN_UID, ADMIN_CLAIMS), TRADIE_UID)),
    );
  });

  it("another tradesperson cannot list someone else's sessions", async () => {
    await seed();
    await assertFails(
      getDocs(activeClockQuery(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), TRADIE_UID)),
    );
  });

  it("a client cannot enumerate a tradesperson's sessions across jobs", async () => {
    await seed();
    await assertFails(
      getDocs(activeClockQuery(fsAs(CLIENT_UID, CLIENT_CLAIMS), TRADIE_UID)),
    );
  });
});
