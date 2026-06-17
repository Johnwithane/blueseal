// jobBoardCounters/{uid} — the per-user "new jobs in your area" badge counter.
// The onJobPostCreated trigger (Admin SDK, bypasses rules) increments `count`;
// the header renders it as a badge on "Browse open jobs". The ONLY client-side
// write allowed is the reset to 0 (opening the board) — a client must never be
// able to inflate its own badge or read/write anyone else's.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
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

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

function counterDoc(fs: ReturnType<typeof fsAs>, ownerUid: string) {
  return doc(fs, "jobBoardCounters", ownerUid);
}

// Simulate the server-side fan-out having bumped the counter.
async function seedCounter(ownerUid: string, count: number) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "jobBoardCounters", ownerUid), {
      count,
      lastJobAt: new Date(),
      updatedAt: new Date(),
    });
  });
}

describe("jobBoardCounters/{uid} — new-jobs badge", () => {
  it("owner can read their own counter", async () => {
    await seedCounter(TRADIE_UID, 5);
    await assertSucceeds(getDoc(counterDoc(fsAs(TRADIE_UID, TRADIE_CLAIMS), TRADIE_UID)));
  });

  it("owner can reset the badge to 0 (open-the-board)", async () => {
    await seedCounter(TRADIE_UID, 5);
    await assertSucceeds(
      setDoc(
        counterDoc(fsAs(TRADIE_UID, TRADIE_CLAIMS), TRADIE_UID),
        { count: 0, lastSeenAt: new Date(), updatedAt: new Date() },
        { merge: true },
      ),
    );
  });

  it("owner can create their own counter only at 0", async () => {
    await assertSucceeds(
      setDoc(
        counterDoc(fsAs(TRADIE_UID, TRADIE_CLAIMS), TRADIE_UID),
        { count: 0, lastSeenAt: new Date(), updatedAt: new Date() },
        { merge: true },
      ),
    );
  });

  it("owner CANNOT inflate their own badge (count > 0)", async () => {
    // create path
    await assertFails(
      setDoc(counterDoc(fsAs(TRADIE_UID, TRADIE_CLAIMS), TRADIE_UID), {
        count: 9,
        updatedAt: new Date(),
      }),
    );
    // update path
    await seedCounter(TRADIE_UID, 1);
    await assertFails(
      setDoc(
        counterDoc(fsAs(TRADIE_UID, TRADIE_CLAIMS), TRADIE_UID),
        { count: 99 },
        { merge: true },
      ),
    );
  });

  it("another user cannot read or write someone else's counter", async () => {
    await seedCounter(TRADIE_UID, 3);
    const other = fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS);
    await assertFails(getDoc(counterDoc(other, TRADIE_UID)));
    await assertFails(
      setDoc(counterDoc(other, TRADIE_UID), { count: 0 }, { merge: true }),
    );
  });

  it("nobody can delete a counter (not even the owner)", async () => {
    await seedCounter(TRADIE_UID, 2);
    await assertFails(deleteDoc(counterDoc(fsAs(TRADIE_UID, TRADIE_CLAIMS), TRADIE_UID)));
  });

  it("admin is not the owner — no special read access to the badge", async () => {
    await seedCounter(TRADIE_UID, 4);
    await assertFails(getDoc(counterDoc(fsAs(ADMIN_UID, ADMIN_CLAIMS), TRADIE_UID)));
  });
});
