// projects/{projectId} — a project manager's bundle of jobs for one client. The
// whole doc is server-managed (createProject / claimProjectInvite / respondToProject
// via the admin SDK): no direct client writes. Read is the owning PM, the linked
// client (clientId, set on claim), or admin.

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
const PROJECT_ID = "proj-1";

function seedProjectDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectManagerId: PM_UID,
    clientId: null,
    propertyId: null,
    label: "Spring turnover",
    clientName: "Pat Client",
    jobSpecs: [{ trade: "painter", title: "Repaint unit", description: "Two coats" }],
    status: "invited",
    projectInvite: {
      emailLower: "pat@example.com",
      clientName: "Pat Client",
      status: "invited",
      tokenHash: "hash",
    },
    claimedAt: null,
    acceptedAt: null,
    declinedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function seedProject(overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "projects", PROJECT_ID), seedProjectDoc(overrides));
  });
}

describe("projects — read", () => {
  it("the owning PM can read their project", async () => {
    await seedProject();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "projects", PROJECT_ID)));
  });

  it("the linked client can read the project they claimed", async () => {
    await seedProject({ clientId: CLIENT_UID, status: "claimed" });
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "projects", PROJECT_ID)));
  });

  it("an unrelated user cannot read the project", async () => {
    await seedProject();
    const fs = env.authenticatedContext(OTHER_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "projects", PROJECT_ID)));
  });
});

describe("projects — writes are server-managed", () => {
  it("a PM cannot create a project directly (callable-only)", async () => {
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "projects", PROJECT_ID), {
        ...seedProjectDoc(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("the linked client cannot change status directly (server-managed)", async () => {
    await seedProject({ clientId: CLIENT_UID, status: "claimed" });
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "projects", PROJECT_ID), { status: "accepted" }));
  });

  it("the owning PM cannot edit the project directly", async () => {
    await seedProject();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "projects", PROJECT_ID), { label: "Renamed" }));
  });

  it("the owning PM cannot delete the project", async () => {
    await seedProject();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "projects", PROJECT_ID)));
  });
});
