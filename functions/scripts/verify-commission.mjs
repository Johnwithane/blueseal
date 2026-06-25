// End-to-end verification of sales-rep COMMISSION ACCRUAL + REVERSAL (M5b)
// against the REAL deployed webhook + Firestore (test-mode Stripe). Seeds a rep
// who owns a referred tradesperson, drives a $1,000 invoice card payment (the
// same destination-charge shape createInvoicePaymentIntent produces), waits for
// the live webhook to accrue the 10% commission, asserts it, then fully refunds
// and asserts the offsetting reversal. Cleans up everything.
//
//   STRIPE_SECRET_KEY=sk_test_... node functions/scripts/verify-commission.mjs
//
// Needs ADC for firebase-admin (gcloud auth application-default login) + the
// Stripe test secret key. NEVER run with a live key.

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

// --- disposable ids ---
const REP = "verify-rep-claude";
const TRADIE = "verify-ctradie-claude";
const CLIENT = "verify-cclient-claude";
const REGION = "verify-region-claude";
const JOB = "verify-cjob-claude";
const INVOICE = "verify-cinv-claude";
const ACCRUAL_ID = `service_fee_${INVOICE}`;
const REVERSAL_ID = `service_fee_${INVOICE}_reversal`;

// --- fee math (mirror serviceFee.ts) for a $1,000 invoice, not waived ---
const base = 100_000;
const raw = Math.round((base * 500) / 10_000); // 5000
const platformPortion = Math.min(Math.max(raw, 200), 9900); // 5000
const chargeTotal = Math.ceil((base + platformPortion + 30) / (1 - 0.029)); // 108167
const processingPortion = chargeTotal - base - platformPortion;
const totalFee = platformPortion + processingPortion;
const expectedCommission = Math.round((platformPortion * 1000) / 10_000); // 500 (10%)

let tradieAcct;
let chargeId;

async function seed() {
  // Chargeable test connected account so the destination charge succeeds.
  tradieAcct = await stripe.accounts.create({
    type: "custom",
    country: "CA",
    email: `${TRADIE}@example.com`,
    capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
    business_type: "individual",
    business_profile: { mcc: "1711", url: "https://blueseal.app", product_description: "Trade services" },
    individual: {
      first_name: "Verify", last_name: "CTradie", email: `${TRADIE}@example.com`,
      phone: "+15555550123", dob: { day: 1, month: 1, year: 1990 },
      address: { line1: "123 Test St", city: "Vancouver", state: "BC", postal_code: "V6B1A1", country: "CA" },
      id_number: "000000000", relationship: { title: "Owner" },
    },
    external_account: { object: "bank_account", country: "CA", currency: "cad", routing_number: "11000-000", account_number: "000123456789" },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "8.8.8.8" },
  });
  for (let i = 0; i < 12 && tradieAcct.capabilities?.transfers !== "active"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    tradieAcct = await stripe.accounts.retrieve(tradieAcct.id);
  }
  if (tradieAcct.capabilities?.transfers !== "active") {
    throw new Error(`tradie transfers capability still ${tradieAcct.capabilities?.transfers}`);
  }

  const now = FieldValue.serverTimestamp();
  // Rep (active sales rep). Accrual only checks salesRep.active !== false.
  await db.doc(`users/${REP}`).set(
    {
      displayName: "Verify Rep", email: `${REP}@example.com`, roles: ["client", "sales"],
      salesRep: { referralCode: "VERIFYCLAUDE", active: true, createdAt: now },
    },
    { merge: true },
  );
  // Region owned by the rep.
  await db.doc(`regions/${REGION}`).set({
    name: "Verify Region", province: "BC", fsaPrefixes: ["V"], repId: REP, status: "active",
    activeTradieCount: 0, totalTradieCount: 0,
    marketing: { thresholdActive: 10, unlockedAt: null, allocatedCents: 0, notes: "" },
    createdAt: now, updatedAt: now, updatedBy: "verify",
  });
  // Referred tradesperson (referral beats region, but both point at the rep).
  await db.doc(`tradespeople/${TRADIE}`).set({
    displayName: "Verify CTradie", referredByRepId: REP, regionId: REGION,
    paidJobsCount: 0, paidLifetimeCents: 0,
  });
  await db.doc(`users/${TRADIE}`).set({ displayName: "Verify CTradie", email: `${TRADIE}@example.com`, roles: ["tradesperson"] }, { merge: true });
  await db.doc(`users/${CLIENT}`).set({ displayName: "Verify CClient", email: `${CLIENT}@example.com`, roles: ["client"] }, { merge: true });
  await db.doc(`jobs/${JOB}`).set({ tradespersonId: TRADIE, clientId: CLIENT, status: "awaiting_payment", chatId: "verify-cchat-claude" });
  await db.doc(`invoices/${INVOICE}`).set({
    tradespersonId: TRADIE, clientId: CLIENT, jobId: JOB, invoiceNumber: "VERIFY-C-0001",
    status: "sent", total: base, taxTotal: 0, subtotal: base, currency: "CAD",
    payment: {
      paymentIntentId: null, clientSecret: null, chargeId: null,
      serviceFee: { feeModelVersion: 2, baseAmountCents: base, platformPortionCents: platformPortion, processingPortionCents: processingPortion, totalFeeCents: totalFee, chargeTotalCents: chargeTotal, capApplied: false, floorApplied: false, waived: false, computedAt: now },
      transferId: null, transferDestination: tradieAcct.id, refundedAmount: 0, refunds: [], disputeId: null, disputeStatus: null, lastWebhookEventId: null,
    },
  });
  console.log(`✔ Seeded rep + referred tradie + region + invoice; tradie acct ${tradieAcct.id}`);
}

async function pay() {
  const pi = await stripe.paymentIntents.create({
    amount: chargeTotal, currency: "cad", application_fee_amount: totalFee,
    transfer_data: { destination: tradieAcct.id }, confirm: true, payment_method: "pm_card_visa",
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    description: "Blue Seal commission verify",
    metadata: { paymentType: "invoice", invoiceId: INVOICE, jobId: JOB, tradespersonId: TRADIE, clientId: CLIENT, invoiceNumber: "VERIFY-C-0001" },
  });
  chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
  console.log(`✔ PaymentIntent ${pi.id} → ${pi.status}; charge ${chargeId}`);
}

async function waitForDoc(path, predicate, label) {
  for (let i = 0; i < 30; i++) {
    const snap = await db.doc(path).get();
    if (snap.exists && predicate(snap.data())) return snap.data();
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function countAccruals() {
  const q = await db.collection("commissions").where("sourceRef", "==", INVOICE).get();
  return q.size;
}

async function cleanup() {
  await Promise.all([
    db.doc(`commissions/${ACCRUAL_ID}`).delete(),
    db.doc(`commissions/${REVERSAL_ID}`).delete(),
    db.doc(`invoices/${INVOICE}`).delete(),
    db.doc(`jobs/${JOB}`).delete(),
    db.doc(`regions/${REGION}`).delete(),
    db.doc(`tradespeople/${TRADIE}`).delete(),
    db.doc(`users/${TRADIE}`).delete(),
    db.doc(`users/${CLIENT}`).delete(),
    db.doc(`users/${REP}`).delete(),
  ]).catch(() => {});
  if (tradieAcct) await stripe.accounts.del(tradieAcct.id).catch(() => {});
  console.log("✔ Cleaned up.");
}

async function main() {
  console.log("\n▶ Verifying commission accrual + reversal (test mode)\n");
  let ok = true;
  const check = (label, pass) => { console.log(`  ${pass ? "✓" : "✗"} ${label}`); if (!pass) ok = false; };
  try {
    await seed();
    await pay();

    console.log("… waiting for the live webhook to settle + accrue");
    const inv = await waitForDoc(`invoices/${INVOICE}`, (d) => d.status === "paid", "invoice paid");
    if (!inv) throw new Error("invoice never flipped to paid — check the webhook / function logs");
    const accrual = await waitForDoc(`commissions/${ACCRUAL_ID}`, () => true, "accrual");
    if (!accrual) throw new Error("commission never accrued — check stripeWebhook logs");

    console.log("\n  ACCRUAL:");
    check(`id == ${ACCRUAL_ID}`, true);
    check(`repId == ${REP}`, accrual.repId === REP);
    check(`ownerKind == referral`, accrual.ownerKind === "referral");
    check(`source == service_fee`, accrual.source === "service_fee");
    check(`status == accrued`, accrual.status === "accrued");
    check(`grossRevenueCents == ${platformPortion}`, accrual.grossRevenueCents === platformPortion);
    check(`commissionCents == ${expectedCommission} (10%)`, accrual.commissionCents === expectedCommission);
    check(`exactly ONE commission for this invoice (no double)`, (await countAccruals()) === 1);

    console.log("\n  REVERSAL (full refund):");
    await stripe.refunds.create({ charge: chargeId, refund_application_fee: true, reverse_transfer: true });
    const reversal = await waitForDoc(`commissions/${REVERSAL_ID}`, () => true, "reversal");
    if (!reversal) throw new Error("reversal never written — check chargeRefunded logs");
    check(`id == ${REVERSAL_ID}`, true);
    check(`status == reversed`, reversal.status === "reversed");
    check(`reversalOf == ${ACCRUAL_ID}`, reversal.reversalOf === ACCRUAL_ID);
    check(`commissionCents mirrors original (${expectedCommission})`, reversal.commissionCents === expectedCommission);
    const origAfter = (await db.doc(`commissions/${ACCRUAL_ID}`).get()).data();
    check(`original left untouched (still accrued)`, origAfter?.status === "accrued");
    check(`exactly TWO entries now (accrual + reversal)`, (await countAccruals()) === 2);

    console.log(ok ? "\n✅ PASS — commission accrual + reversal verified end-to-end.\n" : "\n❌ FAIL — see the ✗ above.\n");
    await cleanup();
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error("\n✖ Verification error:", err?.message ?? err);
    await cleanup();
    process.exit(1);
  }
}

main();
