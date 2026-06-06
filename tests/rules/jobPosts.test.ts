// jobPosts/{postId}/private/meta — only the post-owning client (and admin) may
// read the private meta (applicationCount, selectedApplicantId, addressPrivate).
// The meta doc has NO clientId field, so a rule keyed on resource.data.clientId
// can never authorize it — ownership must be resolved by looking up the PARENT
// post. These tests pin owner-can-read + everyone-else-denied.

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

const POST_ID = "post_meta_1";
const META_PATH = ["jobPosts", POST_ID, "private", "meta"] as const;

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "jobPosts", POST_ID), { clientId: CLIENT_UID, status: "open" });
    await setDoc(doc(fs, ...META_PATH), {
      applicationCount: 1,
      selectedApplicantId: null,
    });
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

describe("jobPosts/{id}/private/meta — owner read access", () => {
  it("the post-owning client can read the private meta", async () => {
    await seed();
    await assertSucceeds(getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), ...META_PATH)));
  });

  it("an admin can read the private meta", async () => {
    await seed();
    await assertSucceeds(getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), ...META_PATH)));
  });

  it("a different client cannot read another post's meta", async () => {
    await seed();
    await assertFails(getDoc(doc(fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS), ...META_PATH)));
  });

  it("a tradesperson cannot read a post's private meta (bid-blind)", async () => {
    await seed();
    await assertFails(getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), ...META_PATH)));
  });
});
