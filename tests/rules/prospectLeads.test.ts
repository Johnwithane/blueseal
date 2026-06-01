// prospectLeads/{leadId} — a real client request held against an unclaimed
// prospect until they sign up. The owning client can read their own lead to see
// status; nobody else (the prospect has no account yet). All writes flow
// through callables/triggers on the Admin SDK — client writes are denied.

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

const LEAD_ID = "lead_1";

function leadPayload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    clientId: CLIENT_UID,
    clientName: "Client A",
    clientPhotoURL: null,
    prospectId: "p_listed_1",
    emailHash: "deadbeef",
    trade: "plumber",
    title: "Leaky tap",
    description: "Kitchen tap drips",
    urgency: "this_week",
    address: { line1: "1 Main St", city: "Kelowna", region: "BC", postalCode: "V1Y", geo: null },
    intakeFormData: {},
    intakePhotos: [],
    status: "pending_signup",
    createdAt: new Date(),
    expiresAt: new Date(),
    claimedJobId: null,
    respondedAt: null,
    ...overrides,
  };
}

async function seedLead() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "prospectLeads", LEAD_ID), leadPayload({}));
  });
}

describe("prospectLeads — read access", () => {
  it("the owning client can read their own lead", async () => {
    await seedLead();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "prospectLeads", LEAD_ID)));
  });

  it("another client cannot read someone else's lead", async () => {
    await seedLead();
    const fs = env.authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "prospectLeads", LEAD_ID)));
  });

  it("an unauthenticated user cannot read a lead", async () => {
    await seedLead();
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(fs, "prospectLeads", LEAD_ID)));
  });

  it("admin can read any lead", async () => {
    await seedLead();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "prospectLeads", LEAD_ID)));
  });
});

describe("prospectLeads — write protection", () => {
  it("a client cannot create a lead directly", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(setDoc(doc(fs, "prospectLeads", "newlead"), leadPayload({})));
  });

  it("the owning client cannot update their lead directly", async () => {
    await seedLead();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "prospectLeads", LEAD_ID), { status: "cancelled" }),
    );
  });

  it("admin cannot delete a lead from the client side", async () => {
    await seedLead();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "prospectLeads", LEAD_ID)));
  });
});
