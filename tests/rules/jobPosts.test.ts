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

// Scoped ("invited") postings (PM dispatch): readable only by the invited
// contractors (+ owner/admin), NOT every visible tradie — the read rule gates on
// status == 'invited' && uid in invitedContractorIds.
const INVITED_POST_ID = "post_invited_1";

async function seedInvitedPost() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "tradespeople", TRADIE_UID), { isVisible: true });
    await setDoc(doc(fs, "tradespeople", OTHER_TRADIE_UID), { isVisible: true });
    await setDoc(doc(fs, "jobPosts", INVITED_POST_ID), {
      clientId: CLIENT_UID,
      status: "invited",
      invitedContractorIds: [TRADIE_UID],
    });
  });
}

describe("jobPosts — invited (scoped) postings read access", () => {
  it("an invited, visible tradesperson can read the scoped posting", async () => {
    await seedInvitedPost();
    await assertSucceeds(getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "jobPosts", INVITED_POST_ID)));
  });

  it("a visible tradesperson NOT in the invited set cannot read it", async () => {
    await seedInvitedPost();
    await assertFails(
      getDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "jobPosts", INVITED_POST_ID)),
    );
  });

  it("the post-owning client can read their scoped posting", async () => {
    await seedInvitedPost();
    await assertSucceeds(getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "jobPosts", INVITED_POST_ID)));
  });
});

// PM read-only visibility (P3b-3): the dispatching PM reads their project's
// postings + the incoming quotes (applications) to broker compare-and-choose.
const PM_UID = "pm-vis-uid";
const PM_CLAIMS = { roles: ["client", "projectManager"], role: "client" };
const OTHER_PM_UID = "other-pm-uid";
const PM_POST_ID = "post_pm_1";

async function seedPmPostingWithQuote() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "jobPosts", PM_POST_ID), {
      clientId: CLIENT_UID,
      status: "invited",
      invitedContractorIds: [TRADIE_UID],
      createdByProjectManagerId: PM_UID,
      projectId: "proj-x",
    });
    await setDoc(doc(fs, "jobPosts", PM_POST_ID, "applications", TRADIE_UID), {
      tradespersonId: TRADIE_UID,
      clientId: CLIENT_UID,
      status: "pending",
    });
  });
}

describe("jobPosts — PM read-only project visibility", () => {
  it("the dispatching PM can read their scoped posting", async () => {
    await seedPmPostingWithQuote();
    await assertSucceeds(getDoc(doc(fsAs(PM_UID, PM_CLAIMS), "jobPosts", PM_POST_ID)));
  });

  it("a different PM cannot read someone else's posting", async () => {
    await seedPmPostingWithQuote();
    await assertFails(getDoc(doc(fsAs(OTHER_PM_UID, PM_CLAIMS), "jobPosts", PM_POST_ID)));
  });

  it("the dispatching PM can read the incoming quotes (applications)", async () => {
    await seedPmPostingWithQuote();
    await assertSucceeds(
      getDoc(doc(fsAs(PM_UID, PM_CLAIMS), "jobPosts", PM_POST_ID, "applications", TRADIE_UID)),
    );
  });

  it("a different PM cannot read the quotes", async () => {
    await seedPmPostingWithQuote();
    await assertFails(
      getDoc(doc(fsAs(OTHER_PM_UID, PM_CLAIMS), "jobPosts", PM_POST_ID, "applications", TRADIE_UID)),
    );
  });
});
