// jobs/{jobId}/siteVisit — the informal "site visit before quoting" agreement
// (one doc, id "current"). BOTH job parties + admin can READ (the client must
// see + decide, the tradie tracks status). All party WRITES are denied: the
// proposeSiteVisit / respondSiteVisit / acceptApplication callables run with the
// admin SDK (bypassing rules), so the "agreed" state can't be forged by either
// side. These tests pin read-for-parties + write-callable-only.

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
const VISIT_ID = "current";

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "jobs", JOB_ID), {
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      chatId: "chat_1",
      createdAt: new Date(),
      trade: "plumber",
      status: "requested",
    });
    await setDoc(doc(fs, "jobs", JOB_ID, "siteVisit", VISIT_ID), {
      tradespersonId: TRADIE_UID,
      clientId: CLIENT_UID,
      fee: { description: "Site visit / assessment", feeCents: 5000, taxRate: 0 },
      proposedDate: null,
      note: "",
      status: "proposed",
      proposedAt: new Date(),
      decidedAt: null,
      declinedReason: null,
      createdAt: new Date(),
    });
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

const visitRef = (fs: ReturnType<typeof fsAs>) =>
  doc(fs, "jobs", JOB_ID, "siteVisit", VISIT_ID);

describe("jobs/{jobId}/siteVisit — read access", () => {
  it("the assigned tradesperson can read the site visit", async () => {
    await seed();
    await assertSucceeds(getDoc(visitRef(fsAs(TRADIE_UID, TRADIE_CLAIMS))));
  });

  it("the client can read the site visit on their job", async () => {
    await seed();
    await assertSucceeds(getDoc(visitRef(fsAs(CLIENT_UID, CLIENT_CLAIMS))));
  });

  it("an admin can read the site visit", async () => {
    await seed();
    await assertSucceeds(getDoc(visitRef(fsAs(ADMIN_UID, ADMIN_CLAIMS))));
  });

  it("an unrelated client cannot read the site visit", async () => {
    await seed();
    await assertFails(getDoc(visitRef(fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS))));
  });
});

describe("jobs/{jobId}/siteVisit — writes are callable-only", () => {
  const validVisit = {
    tradespersonId: TRADIE_UID,
    clientId: CLIENT_UID,
    fee: { description: "Site visit", feeCents: 0, taxRate: 0 },
    proposedDate: null,
    note: "",
    status: "proposed",
    proposedAt: new Date(),
    decidedAt: null,
    declinedReason: null,
    createdAt: new Date(),
  };

  it("the tradesperson cannot create a site visit directly", async () => {
    await seed();
    await assertFails(
      setDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "jobs", JOB_ID, "siteVisit", "current"), validVisit),
    );
  });

  it("the client cannot self-agree to a proposed site visit", async () => {
    await seed();
    await assertFails(
      updateDoc(visitRef(fsAs(CLIENT_UID, CLIENT_CLAIMS)), { status: "agreed" }),
    );
  });

  it("the tradesperson cannot flip a site visit to agreed", async () => {
    await seed();
    await assertFails(
      updateDoc(visitRef(fsAs(TRADIE_UID, TRADIE_CLAIMS)), { status: "agreed" }),
    );
  });
});
