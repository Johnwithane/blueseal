// assistantConversations/{conversationId} — a user's AI chatbot thread.
// Owner (userId) + admin read; writes are server-only (the aiChat callable,
// Admin SDK) except the owner may delete a thread to clear history.
// messages/{messageId} subdoc mirrors the same owner-or-admin read via a
// parent-doc lookup; all writes there are server-only, including for the
// owner.

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

const CONVERSATION_ID = "conv_1";
const MESSAGE_ID = "msg_1";

const conversationDoc = {
  userId: TRADIE_UID,
  title: "Ask Blue Seal",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const messageDoc = {
  role: "user",
  content: "How do I invoice a job?",
  createdAt: new Date(),
};

async function seedConversation() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "assistantConversations", CONVERSATION_ID), conversationDoc);
    await setDoc(
      doc(fs, "assistantConversations", CONVERSATION_ID, "messages", MESSAGE_ID),
      messageDoc,
    );
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

describe("assistantConversations/{conversationId} — read (owner + admin)", () => {
  it("the owner can read their own conversation", async () => {
    await seedConversation();
    await assertSucceeds(
      getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "assistantConversations", CONVERSATION_ID)),
    );
  });

  it("an admin can read any conversation", async () => {
    await seedConversation();
    await assertSucceeds(
      getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "assistantConversations", CONVERSATION_ID)),
    );
  });

  it("a different user cannot read someone else's conversation", async () => {
    await seedConversation();
    await assertFails(
      getDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "assistantConversations", CONVERSATION_ID)),
    );
  });

  it("a client cannot read a tradesperson's conversation", async () => {
    await seedConversation();
    await assertFails(
      getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "assistantConversations", CONVERSATION_ID)),
    );
  });
});

describe("assistantConversations/{conversationId} — write is server-only (except owner delete)", () => {
  it("the owner cannot create a conversation from the client SDK", async () => {
    await assertFails(
      setDoc(
        doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "assistantConversations", CONVERSATION_ID),
        conversationDoc,
      ),
    );
  });

  it("the owner can delete their own conversation", async () => {
    await seedConversation();
    await assertSucceeds(
      deleteDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "assistantConversations", CONVERSATION_ID)),
    );
  });

  it("a different user cannot delete someone else's conversation", async () => {
    await seedConversation();
    await assertFails(
      deleteDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "assistantConversations", CONVERSATION_ID)),
    );
  });
});

describe("assistantConversations/{conversationId}/messages/{messageId} — read (owner + admin via parent lookup)", () => {
  it("the owner can read a message in their own conversation", async () => {
    await seedConversation();
    await assertSucceeds(
      getDoc(
        doc(
          fsAs(TRADIE_UID, TRADIE_CLAIMS),
          "assistantConversations",
          CONVERSATION_ID,
          "messages",
          MESSAGE_ID,
        ),
      ),
    );
  });

  it("an admin can read a message in any conversation", async () => {
    await seedConversation();
    await assertSucceeds(
      getDoc(
        doc(
          fsAs(ADMIN_UID, ADMIN_CLAIMS),
          "assistantConversations",
          CONVERSATION_ID,
          "messages",
          MESSAGE_ID,
        ),
      ),
    );
  });

  it("a different user cannot read a message in someone else's conversation", async () => {
    await seedConversation();
    await assertFails(
      getDoc(
        doc(
          fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS),
          "assistantConversations",
          CONVERSATION_ID,
          "messages",
          MESSAGE_ID,
        ),
      ),
    );
  });

  it("the owner cannot create a message directly from the client SDK", async () => {
    await seedConversation();
    await assertFails(
      setDoc(
        doc(
          fsAs(TRADIE_UID, TRADIE_CLAIMS),
          "assistantConversations",
          CONVERSATION_ID,
          "messages",
          "new_msg",
        ),
        messageDoc,
      ),
    );
  });
});
