// payouts/{stripePayoutId} — denormalised Stripe Connect payout ledger.
// Read: tradie owns / admin sees all. Write: server-only via webhook
// dispatcher (Admin SDK bypasses rules). These tests verify that posture.

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

const PAYOUT_ID = "po_test_001";

const samplePayout = {
  tradespersonId: TRADIE_UID,
  stripeAccountId: "acct_xxx",
  stripePayoutId: PAYOUT_ID,
  amount: 50_000,
  currency: "cad",
  arrivalDate: new Date(),
  status: "paid",
  failureCode: null,
  failureMessage: null,
  invoiceIds: ["inv_1"],
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function seedPayout() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "payouts", PAYOUT_ID), samplePayout);
  });
}

describe("payouts/{stripePayoutId}", () => {
  describe("read", () => {
    it("tradesperson can read their own payout", async () => {
      await seedPayout();
      const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
      await assertSucceeds(getDoc(doc(fs, "payouts", PAYOUT_ID)));
    });

    it("another tradesperson cannot read someone else's payout", async () => {
      await seedPayout();
      const fs = env
        .authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS)
        .firestore();
      await assertFails(getDoc(doc(fs, "payouts", PAYOUT_ID)));
    });

    it("admin can read any payout", async () => {
      await seedPayout();
      const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
      await assertSucceeds(getDoc(doc(fs, "payouts", PAYOUT_ID)));
    });

    it("client cannot read payouts", async () => {
      await seedPayout();
      const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
      await assertFails(getDoc(doc(fs, "payouts", PAYOUT_ID)));
    });

    it("unauthenticated cannot read", async () => {
      await seedPayout();
      const fs = env.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(fs, "payouts", PAYOUT_ID)));
    });
  });

  describe("write — server-only", () => {
    it("tradesperson cannot create their own payout doc", async () => {
      const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
      await assertFails(setDoc(doc(fs, "payouts", PAYOUT_ID), samplePayout));
    });

    it("admin cannot create a payout doc from the client SDK", async () => {
      const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
      await assertFails(setDoc(doc(fs, "payouts", PAYOUT_ID), samplePayout));
    });

    it("tradesperson cannot update their own payout amount", async () => {
      await seedPayout();
      const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
      await assertFails(
        setDoc(doc(fs, "payouts", PAYOUT_ID), {
          ...samplePayout,
          amount: 999_999_999,
        }),
      );
    });
  });
});
