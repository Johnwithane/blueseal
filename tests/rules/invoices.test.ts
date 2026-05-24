// invoices/{invoiceId} — field-lock coverage for the new server-managed
// `payment` sub-object (Stripe PaymentIntent / refund / dispute mirror).
// Pre-cutover invoices lack the field; the rule's positive equality check
// holds when both sides are undefined. Owner cannot inject the field.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";

import {
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

const INVOICE_ID = "inv_1";

const baselineInvoice = {
  tradespersonId: TRADIE_UID,
  clientId: CLIENT_UID,
  jobId: "job_1",
  invoiceNumber: "0001",
  status: "draft",
  lineItems: [],
  subtotal: 0,
  taxTotal: 0,
  total: 0,
  currency: "CAD",
  issuedAt: null,
  dueAt: null,
  sentAt: null,
  viewedAt: null,
  paidAt: null,
  pdfUrl: null,
  paymentInstructions: "",
  paymentMethod: "manual",
  recurring: null,
};

async function seedInvoice() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), "invoices", INVOICE_ID),
      baselineInvoice,
    );
  });
}

describe("invoices — payment field lock", () => {
  it("tradesperson can edit lineItems on their draft invoice", async () => {
    await seedInvoice();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "invoices", INVOICE_ID), {
        lineItems: [
          {
            description: "Labour",
            quantity: 1,
            unitPrice: 10_000,
            taxRate: 0,
          },
        ],
      }),
    );
  });

  it("tradesperson cannot inject a payment field (server-managed)", async () => {
    await seedInvoice();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "invoices", INVOICE_ID), {
        payment: {
          paymentIntentId: "pi_self_granted",
          clientSecret: "secret",
          chargeId: null,
          applicationFeeAmount: 0,
          applicationFeeBps: 0,
          transferId: null,
          transferDestination: null,
          refundedAmount: 0,
          refunds: [],
          disputeId: null,
          disputeStatus: null,
          lastWebhookEventId: null,
        },
      }),
    );
  });
});
