// commissions/{id} + commissionPayouts/{id} — the sales-rep ledger. Read is
// admin OR the owning rep; all writes are server-only (accrual hooks + payout
// scheduler use the Admin SDK), so even an admin client write must fail.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
  CLIENT_UID,
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

const REP_UID = "rep-uid";
const OTHER_REP_UID = "other-rep-uid";
const REP_CLAIMS = { roles: ["client", "sales"], role: "client" };

const COMMISSION_ID = "comm-1";
const PAYOUT_ID = "payout-1";

async function seedCommission() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "commissions", COMMISSION_ID), {
      repId: REP_UID,
      regionId: "region-north",
      tradespersonId: "tradie-1",
      ownerKind: "region",
      source: "service_fee",
      sourceRef: "invoice-1",
      grossRevenueCents: 5000,
      rateBps: 1000,
      commissionCents: 500,
      status: "accrued",
      payoutBatchId: null,
      reversalOf: null,
      createdAt: new Date(),
    });
    await setDoc(doc(ctx.firestore(), "commissionPayouts", PAYOUT_ID), {
      repId: REP_UID,
      stripeTransferId: null,
      amountCents: 500,
      commissionIds: [COMMISSION_ID],
      periodStart: new Date(),
      periodEnd: new Date(),
      status: "pending",
      createdAt: new Date(),
    });
  });
}

describe("commissions ledger — read access", () => {
  it("the owning rep can read their commission", async () => {
    await seedCommission();
    const fs = env.authenticatedContext(REP_UID, REP_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "commissions", COMMISSION_ID)));
  });

  it("an admin can read any commission", async () => {
    await seedCommission();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "commissions", COMMISSION_ID)));
  });

  it("a different rep cannot read someone else's commission", async () => {
    await seedCommission();
    const fs = env.authenticatedContext(OTHER_REP_UID, REP_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "commissions", COMMISSION_ID)));
  });

  it("a client cannot read a commission", async () => {
    await seedCommission();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "commissions", COMMISSION_ID)));
  });

  it("the owning rep can read their payout batch", async () => {
    await seedCommission();
    const fs = env.authenticatedContext(REP_UID, REP_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "commissionPayouts", PAYOUT_ID)));
  });
});

describe("commissions ledger — server-only writes", () => {
  it("the rep cannot mint their own commission", async () => {
    const fs = env.authenticatedContext(REP_UID, REP_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "commissions", COMMISSION_ID), {
        repId: REP_UID,
        commissionCents: 999999,
        status: "accrued",
      }),
    );
  });

  it("even an admin cannot write a commission from the client", async () => {
    await seedCommission();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "commissions", COMMISSION_ID), { status: "paid" }));
  });

  it("the rep cannot edit a payout batch", async () => {
    await seedCommission();
    const fs = env.authenticatedContext(REP_UID, REP_CLAIMS).firestore();
    await assertFails(updateDoc(doc(fs, "commissionPayouts", PAYOUT_ID), { status: "paid" }));
  });
});
