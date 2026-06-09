// rebatePrograms/{slug} — curated government/utility rebate & grant programs.
// Public reference data: world-readable so the post-a-job rebate panel renders
// for any visitor, but only admins may curate it.

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

const SLUG = "test-program";

function programPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: SLUG,
    name: "Test Program",
    provider: "Test Provider",
    level: "federal",
    national: true,
    provinces: [],
    trades: ["hvac"],
    summary: "A test rebate program.",
    amountNote: "Up to $1,000",
    eligibilityNote: "Some conditions apply.",
    officialUrl: "https://example.gc.ca/rebate",
    status: "active",
    lastVerifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: ADMIN_UID,
    ...overrides,
  };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "rebatePrograms", SLUG), programPayload());
  });
}

describe("rebatePrograms — read access", () => {
  it("is world-readable to an anonymous visitor", async () => {
    await seed();
    const fs = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(fs, "rebatePrograms", SLUG)));
  });

  it("is readable by a signed-in client", async () => {
    await seed();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "rebatePrograms", SLUG)));
  });
});

describe("rebatePrograms — write protection", () => {
  it("an admin can create", async () => {
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(setDoc(doc(fs, "rebatePrograms", SLUG), programPayload()));
  });

  it("an admin can update", async () => {
    await seed();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(fs, "rebatePrograms", SLUG), { status: "closed" }));
  });

  it("an admin can delete", async () => {
    await seed();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(deleteDoc(doc(fs, "rebatePrograms", SLUG)));
  });

  it("an anonymous visitor cannot create", async () => {
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(fs, "rebatePrograms", SLUG), programPayload()));
  });

  it("a client cannot create", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(setDoc(doc(fs, "rebatePrograms", SLUG), programPayload()));
  });

  it("a tradesperson cannot update", async () => {
    await seed();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "rebatePrograms", SLUG), { status: "closed" }));
  });

  it("a client cannot delete", async () => {
    await seed();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "rebatePrograms", SLUG)));
  });
});
