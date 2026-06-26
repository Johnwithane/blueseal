// properties/{propertyId} — a project manager's owned property. Read is the
// owning PM (or the connected client) + admin; create/update require the
// projectManager role and pin projectManagerId; linkedClientId is server-managed;
// delete is admin-only.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

import { CLIENT_CLAIMS, CLIENT_UID, setupTestEnv } from "./setup";

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

const PM_UID = "pm-uid";
const PM_CLAIMS = { roles: ["client", "projectManager"], role: "client" };
const OTHER_UID = "other-uid";
const PROP_ID = "prop-1";

function seedPropertyDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectManagerId: PM_UID,
    label: "Unit 4B",
    addressText: "123 Main St",
    notes: null,
    linkedClientId: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function seedProperty(overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "properties", PROP_ID), seedPropertyDoc(overrides));
  });
}

describe("properties — create", () => {
  it("a project manager can create their own property", async () => {
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertSucceeds(
      setDoc(doc(fs, "properties", PROP_ID), {
        projectManagerId: PM_UID,
        label: "Unit 4B",
        addressText: "123 Main St",
        notes: null,
        linkedClientId: null,
        archivedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("a non-PM client cannot create a property", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "properties", PROP_ID), {
        projectManagerId: CLIENT_UID,
        label: "Unit 4B",
        addressText: "",
        notes: null,
        linkedClientId: null,
        archivedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("a PM cannot create a property already linked to a client (server-managed)", async () => {
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "properties", PROP_ID), {
        projectManagerId: PM_UID,
        label: "Unit 4B",
        addressText: "",
        notes: null,
        linkedClientId: CLIENT_UID,
        archivedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe("properties — read", () => {
  it("the owning PM can read their property", async () => {
    await seedProperty();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "properties", PROP_ID)));
  });

  it("a connected client can read the property they're linked to", async () => {
    await seedProperty({ linkedClientId: CLIENT_UID });
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "properties", PROP_ID)));
  });

  it("an unrelated user cannot read the property", async () => {
    await seedProperty();
    const fs = env.authenticatedContext(OTHER_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "properties", PROP_ID)));
  });
});

describe("properties — update + delete", () => {
  it("the owning PM can edit the label", async () => {
    await seedProperty();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(fs, "properties", PROP_ID), { label: "Unit 5C" }));
  });

  it("the owning PM cannot change linkedClientId (server-managed)", async () => {
    await seedProperty();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "properties", PROP_ID), { linkedClientId: OTHER_UID }));
  });

  it("the owning PM cannot hard-delete (admin only)", async () => {
    await seedProperty();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "properties", PROP_ID)));
  });
});
