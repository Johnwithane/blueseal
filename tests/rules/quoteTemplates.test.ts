// tradespeople/{uid}/quoteTemplates — reusable scope-of-work blueprints for
// the quote composer. Owner-only working data: another tradie (or a client)
// must never read someone's pricing playbook, and bounds stop doc bloat.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";

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

const TEMPLATE_ID = "tpl_1";

function template(overrides: Record<string, unknown> = {}) {
  return {
    name: "Bathroom reno — full",
    lineItems: [
      { kind: "labour", description: "Demo + prep", quantity: 1, unitPrice: 50_000, taxRate: 0.13 },
      { kind: "materials", description: "Fixtures", quantity: 1, unitPrice: 120_000, taxRate: 0.13 },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

function tplDoc(fs: ReturnType<typeof fsAs>, ownerUid: string, id = TEMPLATE_ID) {
  return doc(fs, "tradespeople", ownerUid, "quoteTemplates", id);
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), "tradespeople", TRADIE_UID, "quoteTemplates", TEMPLATE_ID),
      template(),
    );
  });
}

describe("tradespeople/{uid}/quoteTemplates — owner-only blueprints", () => {
  it("owner can create, list, and delete a template", async () => {
    const fs = fsAs(TRADIE_UID, TRADIE_CLAIMS);
    await assertSucceeds(setDoc(tplDoc(fs, TRADIE_UID), template()));
    await assertSucceeds(getDocs(collection(fs, "tradespeople", TRADIE_UID, "quoteTemplates")));
    await assertSucceeds(deleteDoc(tplDoc(fs, TRADIE_UID)));
  });

  it("rejects an out-of-bounds template (empty lines, long name)", async () => {
    const fs = fsAs(TRADIE_UID, TRADIE_CLAIMS);
    await assertFails(setDoc(tplDoc(fs, TRADIE_UID, "bad1"), template({ lineItems: [] })));
    await assertFails(setDoc(tplDoc(fs, TRADIE_UID, "bad2"), template({ name: "n".repeat(61) })));
  });

  it("another tradesperson cannot read or write someone's templates", async () => {
    await seed();
    const other = fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS);
    await assertFails(getDoc(tplDoc(other, TRADIE_UID)));
    await assertFails(setDoc(tplDoc(other, TRADIE_UID, "intruder"), template()));
  });

  it("a client cannot read templates", async () => {
    await seed();
    await assertFails(getDoc(tplDoc(fsAs(CLIENT_UID, CLIENT_CLAIMS), TRADIE_UID)));
  });

  it("admin can read", async () => {
    await seed();
    await assertSucceeds(getDoc(tplDoc(fsAs(ADMIN_UID, ADMIN_CLAIMS), TRADIE_UID)));
  });
});
