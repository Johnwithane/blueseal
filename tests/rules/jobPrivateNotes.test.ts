// jobs/{jobId}/private/notes — the tradesperson's private job log. The whole
// point of moving it off the job doc is that the CLIENT (who can read the job
// doc) must NOT be able to read or write these notes. These tests pin that
// contract: only the assigned tradesperson + admin can touch the subdoc.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { Timestamp, doc, getDoc, setDoc } from "firebase/firestore";

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

const JOB_ID = "job_notes_1";
const NOTES_PATH = ["jobs", JOB_ID, "private", "notes"] as const;

async function seedJobAndNotes(notes = "existing note") {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "jobs", JOB_ID), {
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      chatId: "chat_1",
      status: "in_progress",
      trade: "plumbing",
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(fs, ...NOTES_PATH), { notes, lastAutoUpdateAt: null });
  });
}

describe("jobs/{jobId}/private/notes — tradie-only", () => {
  it("assigned tradesperson can read the notes", async () => {
    await seedJobAndNotes();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(tradie, ...NOTES_PATH)));
  });

  it("assigned tradesperson can write the notes", async () => {
    await seedJobAndNotes();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      setDoc(doc(tradie, ...NOTES_PATH), { notes: "updated" }, { merge: true }),
    );
  });

  it("CLIENT cannot read the notes (the whole point)", async () => {
    await seedJobAndNotes();
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(client, ...NOTES_PATH)));
  });

  it("CLIENT cannot write the notes", async () => {
    await seedJobAndNotes();
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(client, ...NOTES_PATH), { notes: "snooping" }, { merge: true }),
    );
  });

  it("a different tradesperson cannot read or write the notes", async () => {
    await seedJobAndNotes();
    const other = env.authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(getDoc(doc(other, ...NOTES_PATH)));
    await assertFails(
      setDoc(doc(other, ...NOTES_PATH), { notes: "nope" }, { merge: true }),
    );
  });

  it("admin can read and write the notes", async () => {
    await seedJobAndNotes();
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(admin, ...NOTES_PATH)));
    await assertSucceeds(
      setDoc(doc(admin, ...NOTES_PATH), { notes: "admin edit" }, { merge: true }),
    );
  });

  it("rejects a non-string notes field", async () => {
    await seedJobAndNotes();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(tradie, ...NOTES_PATH), { notes: 12345 }, { merge: true }),
    );
  });
});
