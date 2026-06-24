// Admin cross-system browse: the /admin/jobs view lists EVERY job and job-board
// posting with an unfiltered collection query (listAllJobs / listAllJobPosts).
// That only works because the jobs + jobPosts read rules OR in isAdmin(), which
// is resource-independent, so the rule is satisfiable for the whole collection.
// These tests pin that contract — and prove a non-admin party still can't
// enumerate either collection ("rules are not filters"), so a future rule edit
// can't silently turn the admin browse into a data leak.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { Timestamp, collection, doc, getDocs, setDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
  CLIENT_UID,
  OTHER_CLIENT_UID,
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
  // Seed one job + one posting owned by CLIENT_UID so the collections aren't
  // empty (an empty collection would let any query trivially "succeed").
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "jobs", "job_1"), {
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      chatId: "chat_1",
      status: "in_progress",
      trade: "plumbing",
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(fs, "jobPosts", "post_1"), {
      clientId: CLIENT_UID,
      status: "open",
      trade: "plumbing",
      createdAt: Timestamp.now(),
    });
  });
});

describe("admin browse — list all jobs", () => {
  it("admin can list the whole jobs collection", async () => {
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDocs(collection(admin, "jobs")));
  });

  it("admin can list the whole jobPosts collection", async () => {
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDocs(collection(admin, "jobPosts")));
  });
});

describe("admin browse — non-admin cannot enumerate", () => {
  it("a non-party client cannot list all jobs", async () => {
    const client = env
      .authenticatedContext(OTHER_CLIENT_UID, { ...CLIENT_CLAIMS })
      .firestore();
    await assertFails(getDocs(collection(client, "jobs")));
  });

  it("a non-owner client cannot list all jobPosts", async () => {
    const client = env
      .authenticatedContext(OTHER_CLIENT_UID, { ...CLIENT_CLAIMS })
      .firestore();
    await assertFails(getDocs(collection(client, "jobPosts")));
  });
});
