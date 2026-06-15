import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
  CLIENT_UID,
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
  // Seed the public stats doc with rules disabled (the scheduled function writes
  // it via the Admin SDK in prod).
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "platformStats", "current"), {
      verifiedPros: 100,
      jobs: 50,
      jobsCompleted: 30,
    });
  });
});

describe("platformStats — public read, server-only write", () => {
  it("an unauthenticated visitor can read the counts", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, "platformStats", "current")));
  });

  it("a signed-in client cannot write", async () => {
    const db = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(setDoc(doc(db, "platformStats", "current"), { verifiedPros: 999 }));
  });

  it("even an admin client cannot write (server-only)", async () => {
    const db = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(setDoc(doc(db, "platformStats", "current"), { verifiedPros: 999 }));
  });
});
