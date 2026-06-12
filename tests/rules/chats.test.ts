// chats/{chatId} update contract. Parties may mark a chat read (unreadCounts)
// and bump lastMessage metadata, but identity fields stay locked and the
// server-managed `awayAlertAt` debounce (the email/push rate-limiter written by
// onMessageCreated, admin SDK) must be pinned — otherwise a party could set the
// OTHER side's timestamp to "now" and suppress their out-of-app alerts.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { Timestamp, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

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
});

const CHAT_ID = "chat_away_1";

async function seedChat(extras: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "chats", CHAT_ID), {
      jobId: "job_1",
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      lastMessageAt: Timestamp.now(),
      lastMessagePreview: "hi",
      unreadCounts: { [CLIENT_UID]: 2, [TRADIE_UID]: 0 },
      ...extras,
    });
  });
}

describe("chats update — mark read + awayAlertAt pin", () => {
  it("client can mark their own unread count to zero", async () => {
    await seedChat();
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(client, "chats", CHAT_ID), { [`unreadCounts.${CLIENT_UID}`]: 0 }),
    );
  });

  it("a non-party cannot touch the chat", async () => {
    await seedChat();
    const stranger = env.authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(stranger, "chats", CHAT_ID), { [`unreadCounts.${OTHER_CLIENT_UID}`]: 0 }),
    );
  });

  it("a party cannot write awayAlertAt (would suppress the other side's alerts)", async () => {
    await seedChat();
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(client, "chats", CHAT_ID), {
        [`awayAlertAt.${TRADIE_UID}`]: serverTimestamp(),
      }),
    );
  });

  it("a party cannot clear an existing awayAlertAt either", async () => {
    await seedChat({ awayAlertAt: { [TRADIE_UID]: Timestamp.now() } });
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(client, "chats", CHAT_ID), { awayAlertAt: {} }),
    );
  });

  it("marking read still works on a chat that already has awayAlertAt set", async () => {
    await seedChat({ awayAlertAt: { [CLIENT_UID]: Timestamp.now() } });
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(client, "chats", CHAT_ID), { [`unreadCounts.${CLIENT_UID}`]: 0 }),
    );
  });

  it("admin can write awayAlertAt", async () => {
    await seedChat();
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(admin, "chats", CHAT_ID), {
        [`awayAlertAt.${CLIENT_UID}`]: serverTimestamp(),
      }),
    );
  });

  it("a party cannot reassign the chat to themselves", async () => {
    await seedChat();
    const stranger = env.authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(stranger, "chats", CHAT_ID), { clientId: OTHER_CLIENT_UID }),
    );
  });
});
