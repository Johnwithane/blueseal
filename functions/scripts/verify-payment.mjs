// End-to-end verification of the invoice card-payment money path against the
// REAL deployed webhook + Firestore (test-mode Stripe). Seeds disposable
// verify-*-claude docs, drives a test-card destination charge with the same
// shape createInvoicePaymentIntent produces, waits for the live webhook to flip
// the invoice to paid, asserts the fee accounting, then cleans up.
//
//   STRIPE_SECRET_KEY=sk_test_... node functions/scripts/verify-payment.mjs
//
// Needs ADC for firebase-admin (gcloud auth application-default login) + the
// Stripe test secret key.

import Stripe from "stripe";
import admin from "firebase-admin";

const API_VERSION = "2026-04-22.dahlia";
const key = process.env.STRIPE_SECRET_KEY;
if (!key || !key.startsWith("sk_test_")) {
  console.error("✖ Set STRIPE_SECRET_KEY to a sk_test_ key.");
  process.exit(1);
}
const stripe = new Stripe(key, { apiVersion: API_VERSION });

admin.initializeApp({ projectId: "blueseal-762af" });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// --- ids (disposable) ---
const TRADIE = "verify-tradie-claude";
const CLIENT = "verify-client-claude";
const JOB = "verify-job-claude";
const INVOICE = "verify-inv-claude";

// --- fee math (mirror serviceFee.ts) for a $1,000 invoice, not waived ---
const base = 100_000;
const raw = Math.round((base * 500) / 10_000); // 5000
const platformPortion = Math.min(Math.max(raw, 200), 9900); // 5000
const chargeTotal = Math.ceil((base + platformPortion + 30) / (1 - 0.029)); // 108167
const processingPortion = chargeTotal - base - platformPortion;
const totalFee = platformPortion + processingPortion;

let acct;

async function seed() {
  // Chargeable test connected account (Custom, transfers capability) so the
  // destination charge succeeds in test mode.
  acct = await stripe.accounts.create({
    type: "custom",
    country: "CA",
    email: `${TRADIE}@example.com`,
    capabilities: { transfers: { requested: true } },
    business_type: "individual",
    business_profile: { mcc: "1711", url: "https://blueseal.app", product_description: "Trade services" },
    individual: {
      first_name: "Verify",
      last_name: "Tradie",
      email: `${TRADIE}@example.com`,
      phone: "+15555550123",
      dob: { day: 1, month: 1, year: 1990 },
      address: { line1: "123 Test St", city: "Vancouver", state: "BC", postal_code: "V6B1A1", country: "CA" },
      id_number: "000000000",
      relationship: { title: "Owner" },
    },
    external_account: { object: "bank_account", country: "CA", currency: "cad", routing_number: "11000-000", account_number: "000123456789" },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "8.8.8.8" },
  });
  // Capabilities activate async in test mode — poll until transfers is active.
  for (let i = 0; i < 12 && acct.capabilities?.transfers !== "active"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    acct = await stripe.accounts.retrieve(acct.id);
  }
  if (acct.capabilities?.transfers !== "active") {
    console.error("  requirements.currently_due:", acct.requirements?.currently_due);
    throw new Error(`transfers capability still ${acct.capabilities?.transfers}`);
  }
  console.log(`✔ Connected account ${acct.id} (transfers: ${acct.capabilities?.transfers})`);

  const now = FieldValue.serverTimestamp();
  await db.doc(`tradespeople/${TRADIE}`).set({
    payouts: { stripeAccountId: acct.id, onboardingStatus: "enabled", payoutsEnabled: true, chargesEnabled: true, detailsSubmitted: true, disabledReason: null, pendingRequirements: [], lastSyncedAt: now },
    paidJobsCount: 0,
    paidLifetimeCents: 0,
  });
  await db.doc(`users/${TRADIE}`).set({ displayName: "Verify Tradie", email: `${TRADIE}@example.com`, roles: ["tradesperson"] }, { merge: true });
  await db.doc(`users/${CLIENT}`).set({ displayName: "Verify Client", email: `${CLIENT}@example.com`, roles: ["client"] }, { merge: true });
  await db.doc(`jobs/${JOB}`).set({ tradespersonId: TRADIE, clientId: CLIENT, status: "awaiting_payment", chatId: "verify-chat-claude" });
  await db.doc(`invoices/${INVOICE}`).set({
    tradespersonId: TRADIE,
    clientId: CLIENT,
    jobId: JOB,
    invoiceNumber: "VERIFY-0001",
    status: "sent",
    total: base,
    taxTotal: 0,
    subtotal: base,
    currency: "CAD",
    payment: {
      paymentIntentId: null,
      clientSecret: null,
      chargeId: null,
      serviceFee: { feeModelVersion: 2, baseAmountCents: base, platformPortionCents: platformPortion, processingPortionCents: processingPortion, totalFeeCents: totalFee, chargeTotalCents: chargeTotal, capApplied: false, floorApplied: false, waived: false, computedAt: now },
      transferId: null,
      transferDestination: acct.id,
      refundedAmount: 0,
      refunds: [],
      disputeId: null,
      disputeStatus: null,
      lastWebhookEventId: null,
    },
  });
  console.log("✔ Seeded Firestore (tradie, users, job, invoice).");
}

async function pay() {
  const pi = await stripe.paymentIntents.create({
    amount: chargeTotal,
    currency: "cad",
    application_fee_amount: totalFee,
    transfer_data: { destination: acct.id },
    confirm: true,
    payment_method: "pm_card_visa",
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    description: "Blue Seal verify",
    metadata: { paymentType: "invoice", invoiceId: INVOICE, jobId: JOB, tradespersonId: TRADIE, clientId: CLIENT, invoiceNumber: "VERIFY-0001" },
  });
  console.log(`✔ PaymentIntent ${pi.id} → ${pi.status} (charged ${(chargeTotal / 100).toFixed(2)} CAD)`);
}

async function waitForPaid() {
  for (let i = 0; i < 30; i++) {
    const snap = await db.doc(`invoices/${INVOICE}`).get();
    if (snap.data()?.status === "paid") return snap.data();
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function cleanup() {
  await Promise.all([
    db.doc(`invoices/${INVOICE}`).delete(),
    db.doc(`jobs/${JOB}`).delete(),
    db.doc(`tradespeople/${TRADIE}`).delete(),
    db.doc(`users/${TRADIE}`).delete(),
    db.doc(`users/${CLIENT}`).delete(),
  ]).catch(() => {});
  if (acct) await stripe.accounts.del(acct.id).catch(() => {});
  console.log("✔ Cleaned up.");
}

async function main() {
  console.log(`\n▶ Verifying invoice payment money path (test mode)\n`);
  console.log(`  $1,000 invoice → client charged $${(chargeTotal / 100).toFixed(2)}, platform fee $${(platformPortion / 100).toFixed(2)}, tradie nets $${(base / 100).toFixed(2)}\n`);
  try {
    await seed();
    await pay();
    console.log("… waiting for the live webhook to settle the invoice");
    const inv = await waitForPaid();
    if (!inv) throw new Error("Invoice never flipped to paid — check the webhook (webhookEvents collection / function logs).");

    const job = (await db.doc(`jobs/${JOB}`).get()).data();
    const tradie = (await db.doc(`tradespeople/${TRADIE}`).get()).data();

    const checks = [
      ["invoice.status == paid", inv.status === "paid"],
      ["invoice.paidAt set", !!inv.paidAt],
      [`job.serviceFeeCapUsedCents == ${platformPortion}`, job?.serviceFeeCapUsedCents === platformPortion],
      [`tradie.paidLifetimeCents == ${base}`, tradie?.paidLifetimeCents === base],
      ["tradie.paidJobsCount == 1", tradie?.paidJobsCount === 1],
    ];
    console.log("");
    let ok = true;
    for (const [label, pass] of checks) {
      console.log(`  ${pass ? "✓" : "✗"} ${label}`);
      if (!pass) ok = false;
    }
    console.log(ok ? "\n✅ PASS — webhook + fee accounting verified end-to-end.\n" : "\n❌ FAIL — see the ✗ above.\n");
    await cleanup();
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error("\n✖ Verification error:", err?.message ?? err);
    await cleanup();
    process.exit(1);
  }
}

main();
