// users/{uid}/devices — web-push (FCM) token registrations. Owner-only in
// both directions: a token is capability-ish (knowing it lets you target the
// device), so nobody else may read it, and nobody can plant a token on
// someone else's account to siphon their notifications.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";

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

const TOKEN = "fcm-token-abc123";

function device(overrides: Record<string, unknown> = {}) {
  return {
    token: TOKEN,
    userAgent: "Mozilla/5.0 test",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

function deviceDoc(fs: ReturnType<typeof fsAs>, ownerUid: string, id = TOKEN) {
  return doc(fs, "users", ownerUid, "devices", id);
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", CLIENT_UID, "devices", TOKEN), device());
  });
}

describe("users/{uid}/devices — owner-only push registrations", () => {
  it("owner can register, read, and remove a device", async () => {
    const fs = fsAs(CLIENT_UID, CLIENT_CLAIMS);
    await assertSucceeds(setDoc(deviceDoc(fs, CLIENT_UID), device()));
    await assertSucceeds(getDocs(collection(fs, "users", CLIENT_UID, "devices")));
    await assertSucceeds(deleteDoc(deviceDoc(fs, CLIENT_UID)));
  });

  it("rejects out-of-bounds payloads", async () => {
    const fs = fsAs(CLIENT_UID, CLIENT_CLAIMS);
    await assertFails(
      setDoc(deviceDoc(fs, CLIENT_UID, "bad1"), device({ token: "t".repeat(513) })),
    );
    await assertFails(
      setDoc(deviceDoc(fs, CLIENT_UID, "bad2"), device({ extra: "field" })),
    );
    await assertFails(
      setDoc(deviceDoc(fs, CLIENT_UID, "bad3"), device({ userAgent: "u".repeat(301) })),
    );
  });

  it("another user cannot read or write someone's devices", async () => {
    await seed();
    const other = fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS);
    await assertFails(getDoc(deviceDoc(other, CLIENT_UID)));
    await assertFails(setDoc(deviceDoc(other, CLIENT_UID, "intruder"), device()));
    await assertFails(deleteDoc(deviceDoc(other, CLIENT_UID)));
  });

  it("admin can read", async () => {
    await seed();
    await assertSucceeds(getDoc(deviceDoc(fsAs(ADMIN_UID, ADMIN_CLAIMS), CLIENT_UID)));
  });
});
