// projectManagers/{pmId} — a PM's PUBLIC profile (P5). World-read when published
// (isVisible); owner + admin otherwise. The owner (projectManager role) edits
// brand/bio/visibility; `slug` is server-managed (claimPmProfileSlug) and immutable
// to the owner; createdAt is frozen. Delete is admin-only.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

import { CLIENT_CLAIMS, CLIENT_UID, TRADIE_CLAIMS, TRADIE_UID, setupTestEnv } from "./setup";

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

function profileDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    displayName: "Pat PM",
    photoURL: null,
    companyName: "Elm Street Group",
    bio: "We coordinate trusted trades.",
    brandColor: "#1d4ed8",
    companyLogoUrl: null,
    coverUrl: null,
    isVisible: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function seedProfile(overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "projectManagers", PM_UID), profileDoc(overrides));
  });
}

describe("projectManagers — read access", () => {
  it("a published profile is world-readable (even signed out)", async () => {
    await seedProfile({ isVisible: true });
    const fs = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(fs, "projectManagers", PM_UID)));
  });

  it("the owner can read their own unpublished profile", async () => {
    await seedProfile({ isVisible: false });
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "projectManagers", PM_UID)));
  });

  it("a stranger cannot read an unpublished profile", async () => {
    await seedProfile({ isVisible: false });
    const fs = env.authenticatedContext(OTHER_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "projectManagers", PM_UID)));
  });
});

describe("projectManagers — write access", () => {
  it("a project manager can create their own profile (unpublished, no slug)", async () => {
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertSucceeds(
      setDoc(doc(fs, "projectManagers", PM_UID), {
        ...profileDoc({ isVisible: false }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("a non-PM client cannot create a profile", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "projectManagers", CLIENT_UID), {
        ...profileDoc(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("the owner can publish (toggle isVisible) and edit their bio", async () => {
    await seedProfile({ isVisible: false });
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "projectManagers", PM_UID), {
        isVisible: true,
        bio: "Updated bio",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("the owner cannot change their slug (server-managed)", async () => {
    await seedProfile({ slug: "elm-street" });
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "projectManagers", PM_UID), { slug: "hijack" }));
  });

  it("a stranger cannot edit someone else's profile", async () => {
    await seedProfile({ isVisible: true });
    const fs = env.authenticatedContext(OTHER_UID, PM_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "projectManagers", PM_UID), { bio: "hacked" }));
  });

  it("the owner cannot hard-delete (admin only)", async () => {
    await seedProfile();
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "projectManagers", PM_UID)));
  });

  it("the owner cannot write featuredContractors directly (server-managed, P5b)", async () => {
    await seedProfile({ featuredContractors: [] });
    const fs = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "projectManagers", PM_UID), {
        featuredContractors: [{ tradieId: "x", displayName: "X", photoURL: null, trades: [] }],
      }),
    );
  });
});

// P5b contractor-owned subcollections: read by the contractor only; server-only writes.
describe("featuredByPms / pmFeatureOptOuts — contractor read, server-only write", () => {
  async function seedFeaturedBy() {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", TRADIE_UID, "featuredByPms", PM_UID), {
        pmName: "Elm Group",
        featuredAt: new Date(),
      });
    });
  }

  it("the contractor can read who features them", async () => {
    await seedFeaturedBy();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "users", TRADIE_UID, "featuredByPms", PM_UID)));
  });

  it("a stranger cannot read someone else's featuredByPms", async () => {
    await seedFeaturedBy();
    const fs = env.authenticatedContext(OTHER_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "users", TRADIE_UID, "featuredByPms", PM_UID)));
  });

  it("the contractor cannot write featuredByPms directly (server-only)", async () => {
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "users", TRADIE_UID, "featuredByPms", PM_UID), { pmName: "x", featuredAt: new Date() }),
    );
  });

  it("the contractor cannot write pmFeatureOptOuts directly (opt-out is a callable)", async () => {
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "users", TRADIE_UID, "pmFeatureOptOuts", PM_UID), { optedOutAt: new Date() }),
    );
  });
});
