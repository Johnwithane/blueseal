// regions/{regionId} — sales territories. Read is admin OR the region's own
// rep; all writes are server-only (the adminUpsertRegion / adminDeleteRegion
// callables use the Admin SDK, which bypasses rules), so even an admin client
// write must fail here.

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

const REGION_ID = "region-north";
const REP_UID = "rep-uid";
const OTHER_REP_UID = "other-rep-uid";
// A sales rep: the sales role rides in `roles`; legacy primary `role` stays
// "client" (sales is never the legacy primary), mirroring adminSetUserRoles.
const REP_CLAIMS = { roles: ["client", "sales"], role: "client" };
const OTHER_REP_CLAIMS = { roles: ["client", "sales"], role: "client" };

function regionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Northern BC",
    province: "BC",
    fsaPrefixes: ["V8", "V9"],
    repId: REP_UID,
    status: "active",
    activeTradieCount: 0,
    totalTradieCount: 0,
    marketing: { thresholdActive: 40, unlockedAt: null, allocatedCents: 0, notes: "" },
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: ADMIN_UID,
    ...overrides,
  };
}

async function seed(overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "regions", REGION_ID), regionPayload(overrides));
  });
}

describe("regions — read access", () => {
  it("an admin can read any region", async () => {
    await seed();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "regions", REGION_ID)));
  });

  it("the region's own rep can read it", async () => {
    await seed();
    const fs = env.authenticatedContext(REP_UID, REP_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "regions", REGION_ID)));
  });

  it("a different rep cannot read someone else's region", async () => {
    await seed();
    const fs = env.authenticatedContext(OTHER_REP_UID, OTHER_REP_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "regions", REGION_ID)));
  });

  it("a client cannot read a region", async () => {
    await seed();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "regions", REGION_ID)));
  });

  it("a tradesperson cannot read a region", async () => {
    await seed();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "regions", REGION_ID)));
  });

  it("an anonymous visitor cannot read a region", async () => {
    await seed();
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(fs, "regions", REGION_ID)));
  });
});

describe("regions — write protection (server-only)", () => {
  it("an admin cannot create directly from the client", async () => {
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(setDoc(doc(fs, "regions", REGION_ID), regionPayload()));
  });

  it("an admin cannot update directly from the client", async () => {
    await seed();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "regions", REGION_ID), { status: "paused" }));
  });

  it("the region's rep cannot update their own region", async () => {
    await seed();
    const fs = env.authenticatedContext(REP_UID, REP_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "regions", REGION_ID), { fsaPrefixes: ["V8"] }));
  });

  it("nobody can delete directly from the client", async () => {
    await seed();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "regions", REGION_ID)));
  });
});
