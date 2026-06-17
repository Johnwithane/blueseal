// errorLogs/{errorId} — client error telemetry. Written only by the
// reportClientError callable (Admin SDK), so all client create/delete is denied.
// admin + qa read the queue and may toggle ONLY the `resolved` flag (so the QA
// team shares the diagnostics queue). Non-staff can't read.

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

const ERROR_ID = "err_1";

const errorDoc = {
  uid: CLIENT_UID,
  message: "TypeError: x is undefined",
  stack: "at foo (app.js:1:1)",
  source: "vue",
  context: "JobDetail",
  route: "/jobs/abc",
  userAgent: "test",
  appVersion: "abc123",
  resolved: false,
  createdAt: new Date(),
};

async function seedError() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "errorLogs", ERROR_ID), errorDoc);
  });
}

describe("errorLogs — read", () => {
  it("an admin can read the queue", async () => {
    await seedError();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDocs(collection(fs, "errorLogs")));
  });

  it("a qa tester can read the queue", async () => {
    await seedError();
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertSucceeds(getDocs(collection(fs, "errorLogs")));
  });

  it("a non-staff user cannot read errors", async () => {
    await seedError();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "errorLogs", ERROR_ID)));
  });
});

describe("errorLogs — resolve / create / delete", () => {
  it("an admin can toggle resolved", async () => {
    await seedError();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(fs, "errorLogs", ERROR_ID), { resolved: true }));
  });

  it("a qa tester can toggle resolved", async () => {
    await seedError();
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(fs, "errorLogs", ERROR_ID), { resolved: true }));
  });

  it("cannot edit any field other than resolved", async () => {
    await seedError();
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "errorLogs", ERROR_ID), { message: "tampered" }));
  });

  it("clients cannot create error docs (server-only via the callable)", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(addDoc(collection(fs, "errorLogs"), errorDoc));
  });

  it("a qa tester cannot create error docs directly", async () => {
    const fs = env.authenticatedContext(QA_UID, QA_CLAIMS).firestore();
    await assertFails(addDoc(collection(fs, "errorLogs"), errorDoc));
  });

  it("not even an admin can delete an error doc", async () => {
    await seedError();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "errorLogs", ERROR_ID)));
  });
});
