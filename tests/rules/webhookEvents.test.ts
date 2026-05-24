// webhookEvents/{stripeEventId} — internal idempotency sentinel for the
// Stripe webhook dispatcher. Never readable or writable from the client
// SDK; the dispatcher uses the Admin SDK which bypasses rules.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
  CLIENT_UID,
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

const EVENT_ID = "evt_test_001";
const sampleEvent = {
  type: "payment_intent.succeeded",
  receivedAt: new Date(),
  processedAt: new Date(),
  status: "processed",
  errorMessage: null,
};

const roles: Array<[string, string, Record<string, unknown>]> = [
  ["admin", ADMIN_UID, ADMIN_CLAIMS],
  ["tradesperson", TRADIE_UID, TRADIE_CLAIMS],
  ["client", CLIENT_UID, CLIENT_CLAIMS],
];

describe("webhookEvents/{eventId} — server-only", () => {
  describe("read", () => {
    it.each(roles)("%s cannot read", async (_label, uid, claims) => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(ctx.firestore(), "webhookEvents", EVENT_ID),
          sampleEvent,
        );
      });
      const fs = env.authenticatedContext(uid, claims).firestore();
      await assertFails(getDoc(doc(fs, "webhookEvents", EVENT_ID)));
    });

    it("unauthenticated cannot read", async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(ctx.firestore(), "webhookEvents", EVENT_ID),
          sampleEvent,
        );
      });
      const fs = env.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(fs, "webhookEvents", EVENT_ID)));
    });
  });

  describe("write", () => {
    it.each(roles)("%s cannot create", async (_label, uid, claims) => {
      const fs = env.authenticatedContext(uid, claims).firestore();
      await assertFails(
        setDoc(doc(fs, "webhookEvents", EVENT_ID), sampleEvent),
      );
    });

    it("unauthenticated cannot create", async () => {
      const fs = env.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(fs, "webhookEvents", EVENT_ID), sampleEvent),
      );
    });
  });
});
