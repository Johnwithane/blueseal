// jobs/{jobId}/sessions — booked work visits. BOTH job parties (client +
// tradesperson) plus admin can read; only the assigned tradesperson writes.
// The client must SEE when the tradesperson is coming, so the read rule has to
// authorize a LIST from EITHER party — and it does so via the parent job, not a
// per-doc field ("rules are not filters"). These tests pin that, plus the
// tradie-only write path with its parent-identity + end>start guards.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";

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

const JOB_ID = "job_1";
const SESSION_ID = "s1";
const START = new Date("2026-07-01T09:00:00Z");
const END = new Date("2026-07-01T17:00:00Z");

// A well-formed session matching what the sessions service writes. Override a
// field to build the various deny cases.
function validSession(overrides: Record<string, unknown> = {}) {
  return {
    tradespersonId: TRADIE_UID,
    clientId: CLIENT_UID,
    start: START,
    end: END,
    note: "",
    createdAt: START,
    ...overrides,
  };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "jobs", JOB_ID), {
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      status: "in_progress",
    });
    await setDoc(doc(fs, "jobs", JOB_ID, "sessions", SESSION_ID), validSession());
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

// Mirrors subscribeJobSessions: orderBy("start") with NO where clause — read is
// authorized via the parent job, so any party can list.
function sessionsQuery(fs: ReturnType<typeof fsAs>) {
  return query(collection(fs, "jobs", JOB_ID, "sessions"), orderBy("start", "asc"));
}
function sessionRef(fs: ReturnType<typeof fsAs>) {
  return doc(fs, "jobs", JOB_ID, "sessions", SESSION_ID);
}

describe("jobs/{jobId}/sessions — read access for both parties", () => {
  it("the assigned tradesperson can list booked visits", async () => {
    await seed();
    await assertSucceeds(getDocs(sessionsQuery(fsAs(TRADIE_UID, TRADIE_CLAIMS))));
  });

  it("the client can list their job's booked visits (the load-bearing case)", async () => {
    await seed();
    await assertSucceeds(getDocs(sessionsQuery(fsAs(CLIENT_UID, CLIENT_CLAIMS))));
  });

  it("an admin can list booked visits", async () => {
    await seed();
    await assertSucceeds(getDocs(sessionsQuery(fsAs(ADMIN_UID, ADMIN_CLAIMS))));
  });

  it("an unrelated client cannot list booked visits", async () => {
    await seed();
    await assertFails(getDocs(sessionsQuery(fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS))));
  });

  it("an unrelated tradesperson cannot list booked visits", async () => {
    await seed();
    await assertFails(getDocs(sessionsQuery(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS))));
  });
});

describe("jobs/{jobId}/sessions — create (tradie only)", () => {
  it("the assigned tradesperson can book a valid visit", async () => {
    await seed();
    const fs = fsAs(TRADIE_UID, TRADIE_CLAIMS);
    await assertSucceeds(
      setDoc(doc(fs, "jobs", JOB_ID, "sessions", "s_new"), validSession()),
    );
  });

  it("the client cannot book a visit", async () => {
    await seed();
    const fs = fsAs(CLIENT_UID, CLIENT_CLAIMS);
    await assertFails(
      setDoc(doc(fs, "jobs", JOB_ID, "sessions", "s_new"), validSession()),
    );
  });

  it("a visit whose end is not after its start is rejected", async () => {
    await seed();
    const fs = fsAs(TRADIE_UID, TRADIE_CLAIMS);
    await assertFails(
      setDoc(
        doc(fs, "jobs", JOB_ID, "sessions", "s_new"),
        validSession({ end: START }),
      ),
    );
  });

  it("a tradesperson cannot forge a different clientId", async () => {
    await seed();
    const fs = fsAs(TRADIE_UID, TRADIE_CLAIMS);
    await assertFails(
      setDoc(
        doc(fs, "jobs", JOB_ID, "sessions", "s_new"),
        validSession({ clientId: OTHER_CLIENT_UID }),
      ),
    );
  });

  it("another tradesperson cannot book a visit on someone else's job", async () => {
    await seed();
    const fs = fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS);
    await assertFails(
      setDoc(
        doc(fs, "jobs", JOB_ID, "sessions", "s_new"),
        validSession({ tradespersonId: OTHER_TRADIE_UID }),
      ),
    );
  });
});

describe("jobs/{jobId}/sessions — update", () => {
  it("the owner tradesperson can move a visit's times + note", async () => {
    await seed();
    const fs = fsAs(TRADIE_UID, TRADIE_CLAIMS);
    await assertSucceeds(
      setDoc(
        sessionRef(fs),
        validSession({ end: new Date("2026-07-01T18:30:00Z"), note: "first fix" }),
      ),
    );
  });

  it("createdAt cannot be tampered with on update", async () => {
    await seed();
    const fs = fsAs(TRADIE_UID, TRADIE_CLAIMS);
    await assertFails(
      setDoc(sessionRef(fs), validSession({ createdAt: END })),
    );
  });

  it("the client cannot edit a visit", async () => {
    await seed();
    const fs = fsAs(CLIENT_UID, CLIENT_CLAIMS);
    await assertFails(setDoc(sessionRef(fs), validSession({ note: "client edit" })));
  });
});

describe("jobs/{jobId}/sessions — delete", () => {
  it("the owner tradesperson can delete a visit", async () => {
    await seed();
    await assertSucceeds(deleteDoc(sessionRef(fsAs(TRADIE_UID, TRADIE_CLAIMS))));
  });

  it("an admin can delete a visit", async () => {
    await seed();
    await assertSucceeds(deleteDoc(sessionRef(fsAs(ADMIN_UID, ADMIN_CLAIMS))));
  });

  it("the client cannot delete a visit", async () => {
    await seed();
    await assertFails(deleteDoc(sessionRef(fsAs(CLIENT_UID, CLIENT_CLAIMS))));
  });

  it("another tradesperson cannot delete a visit", async () => {
    await seed();
    await assertFails(deleteDoc(sessionRef(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS))));
  });
});
