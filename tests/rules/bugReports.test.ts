// bugReports/{reportId} — QA toolkit manual bug log.
// A qa (or admin) tester creates (locked to the exact shape); the reporter reads
// their own; admins read + triage all and may only change status/notes/triagedBy/
// updatedAt. Non-staff (plain client/tradesperson) can't create, and no one but
// the reporter or an admin can read.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
  CLIENT_UID,
  QA_CLAIMS,
  QA_UID,
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

const REPORT_ID = "bug_1";

function validBug(uid: string) {
  return {
    reporterUid: uid,
    reporterName: "QA Tester",
    url: "https://app.example/jobs/abc",
    route: "JobDetail",
    activeRole: "client",
    severity: "high",
    title: "Quote button does nothing",
    stepsToReproduce: "1. open job 2. click Quote",
    expected: "the quote sheet opens",
    actual: "nothing happens",
    screenshotPaths: [],
    area: "jobs",
    appVersion: "abc123",
    status: "open",
    triagedBy: null,
    notes: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function seedBug(reporterUid = QA_UID) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "bugReports", REPORT_ID), {
      ...validBug(reporterUid),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
}

describe("bugReports — create", () => {
  it("a qa tester can file a valid report for themselves", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertSucceeds(addDoc(collection(fs, "bugReports"), validBug(QA_UID)));
  });

  it("an admin can file a report", async () => {
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(addDoc(collection(fs, "bugReports"), validBug(ADMIN_UID)));
  });

  it("a non-qa client cannot file a report (even for themselves)", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(addDoc(collection(fs, "bugReports"), validBug(CLIENT_UID)));
  });

  it("a non-qa tradesperson cannot file a report", async () => {
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(addDoc(collection(fs, "bugReports"), validBug(TRADIE_UID)));
  });

  it("a signed-out visitor cannot create a report", async () => {
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(addDoc(collection(fs, "bugReports"), validBug(QA_UID)));
  });

  it("cannot spoof another reporterUid", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(addDoc(collection(fs, "bugReports"), validBug(ADMIN_UID)));
  });

  it("cannot create with a non-open status", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(
      addDoc(collection(fs, "bugReports"), { ...validBug(QA_UID), status: "fixed" }),
    );
  });

  it("cannot pre-set triagedBy", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(
      addDoc(collection(fs, "bugReports"), { ...validBug(QA_UID), triagedBy: ADMIN_UID }),
    );
  });

  it("cannot pre-set non-empty notes", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(
      addDoc(collection(fs, "bugReports"), { ...validBug(QA_UID), notes: "preset" }),
    );
  });

  it("cannot include an unexpected field", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(
      addDoc(collection(fs, "bugReports"), { ...validBug(QA_UID), secret: "x" }),
    );
  });

  it("rejects an over-long title", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(
      addDoc(collection(fs, "bugReports"), { ...validBug(QA_UID), title: "x".repeat(141) }),
    );
  });
});

describe("bugReports — read", () => {
  it("the reporter can read their own report", async () => {
    await seedBug(QA_UID);
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "bugReports", REPORT_ID)));
  });

  it("an admin can read any report + list the queue", async () => {
    await seedBug(QA_UID);
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDocs(collection(fs, "bugReports")));
  });

  it("another user cannot read someone else's report", async () => {
    await seedBug(QA_UID);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "bugReports", REPORT_ID)));
  });
});

describe("bugReports — update / delete", () => {
  it("an admin can triage status + notes", async () => {
    await seedBug(QA_UID);
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "bugReports", REPORT_ID), {
        status: "triaged",
        notes: "looking into it",
        triagedBy: ADMIN_UID,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("an admin cannot edit the title via update", async () => {
    await seedBug(QA_UID);
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "bugReports", REPORT_ID), { title: "tampered" }),
    );
  });

  it("the reporter cannot update their own report", async () => {
    await seedBug(QA_UID);
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "bugReports", REPORT_ID), { status: "fixed" }),
    );
  });

  it("a non-admin cannot delete a report", async () => {
    await seedBug(QA_UID);
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "bugReports", REPORT_ID)));
  });

  it("an admin can delete a report", async () => {
    await seedBug(QA_UID);
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(deleteDoc(doc(fs, "bugReports", REPORT_ID)));
  });
});
