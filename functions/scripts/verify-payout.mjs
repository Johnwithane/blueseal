// End-to-end verification of the monthly rep COMMISSION PAYOUT (M6) against the
// REAL deployed scheduler + Firestore (test-mode Stripe). Two phases around a
// manual scheduler trigger:
//
//   STRIPE_SECRET_KEY=sk_test_... node functions/scripts/verify-payout.mjs seed
//   gcloud scheduler jobs run firebase-schedule-scheduledRepCommissionPayouts-us-central1 --location=us-central1 --project blueseal-762af
//   STRIPE_SECRET_KEY=sk_test_... node functions/scripts/verify-payout.mjs check
//
// seed: funds the platform test balance, onboards a throwaway rep Connect
// account, seeds $60 of accrued commissions. check: asserts a paid payout batch
// + the commissions flipped to paid, then cleans up. Needs ADC + a sk_test_ key.

import Stripe from "stripe";
import admin from "firebase-admin";

const API_VERSION = "2026-04-22.dahlia";
const phase = process.argv[2];
const key = process.env.STRIPE_SECRET_KEY;
if (!key || !key.startsWith("sk_test_")) {
  console.error("✖ Set STRIPE_SECRET_KEY to a sk_test_ key.");
  process.exit(1);
}
if (phase !== "seed" && phase !== "check") {
  console.error("✖ Usage: node verify-payout.mjs <seed|check>");
  process.exit(1);
}
const stripe = new Stripe(key, { apiVersion: API_VERSION });
admin.initializeApp({ projectId: "blueseal-762af" });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const REP = "verify-prep-claude";
const TRADIE = "verify-ptradie-claude";
const C1 = "service_fee_verify-p1-claude";
const C2 = "service_fee_verify-p2-claude";
const EXPECTED_NET = 6000; // 3000 + 3000

async function seed() {
  // 1) Fund the platform's available test balance so the transfer clears.
  await stripe.charges.create({
    amount: 20000, currency: "cad", source: "tok_bypassPending", description: "verify payout funding (claude)",
  });
  const bal = await stripe.balance.retrieve();
  const cad = (bal.available.find((a) => a.currency === "cad")?.amount ?? 0);
  console.log(`✔ Platform available CAD balance: $${(cad / 100).toFixed(2)}`);

  // 2) Throwaway rep Connect account (transfers capability active).
  let acct = await stripe.accounts.create({
    type: "custom", country: "CA", email: `${REP}@example.com`,
    capabilities: { transfers: { requested: true } }, business_type: "individual",
    business_profile: { mcc: "1711", url: "https://blueseal.app", product_description: "Sales rep" },
    individual: {
      first_name: "Verify", last_name: "PRep", email: `${REP}@example.com`,
      phone: "+15555550123", dob: { day: 1, month: 1, year: 1990 },
      address: { line1: "123 Test St", city: "Vancouver", state: "BC", postal_code: "V6B1A1", country: "CA" },
      id_number: "000000000", relationship: { title: "Owner" },
    },
    external_account: { object: "bank_account", country: "CA", currency: "cad", routing_number: "11000-000", account_number: "000123456789" },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "8.8.8.8" },
  });
  for (let i = 0; i < 12 && acct.capabilities?.transfers !== "active"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    acct = await stripe.accounts.retrieve(acct.id);
  }
  if (acct.capabilities?.transfers !== "active") throw new Error(`rep transfers capability still ${acct.capabilities?.transfers}`);
  console.log(`✔ Rep Connect account ${acct.id} (transfers active)`);

  const now = FieldValue.serverTimestamp();
  await db.doc(`users/${REP}`).set({
    displayName: "Verify PRep", email: `${REP}@example.com`, roles: ["client", "sales"],
    salesRep: {
      referralCode: "VERIFYPCLAUDE", active: true, createdAt: now,
      payouts: { stripeAccountId: acct.id, onboardingStatus: "enabled", chargesEnabled: false, payoutsEnabled: true, detailsSubmitted: true, disabledReason: null, pendingRequirements: [], lastSyncedAt: now },
    },
  }, { merge: true });

  const commission = (sourceRef) => ({
    repId: REP, regionId: null, tradespersonId: TRADIE, ownerKind: "referral",
    source: "service_fee", sourceRef, grossRevenueCents: 30000, rateBps: 1000,
    commissionCents: 3000, status: "accrued", payoutBatchId: null, reversalOf: null, createdAt: now,
  });
  await db.doc(`commissions/${C1}`).set(commission("verify-p1-claude"));
  await db.doc(`commissions/${C2}`).set(commission("verify-p2-claude"));
  console.log(`✔ Seeded 2 accrued commissions ($${(EXPECTED_NET / 100).toFixed(2)} net) for ${REP}`);

  // Sanity: how many accrued commissions exist platform-wide (should be just ours).
  const allAccrued = await db.collection("commissions").where("status", "==", "accrued").get();
  const reps = [...new Set(allAccrued.docs.map((d) => d.data().repId))];
  console.log(`ℹ Platform-wide accrued commissions: ${allAccrued.size} across reps: ${reps.join(", ")}`);
  if (reps.some((r) => r !== REP)) {
    console.log("⚠ Other reps have accrued commissions — the manual trigger will process them too. Review before triggering.");
  }
  console.log("\n→ Now trigger the scheduler, then run the check phase.\n");
}

async function check() {
  // Poll for the batch the deployed scheduler writes (it runs async after the
  // manual trigger). If it never appears, leave the seed in place so a re-run
  // can still find it (don't clean up a not-yet result).
  let q = await db.collection("commissionPayouts").where("repId", "==", REP).get();
  for (let i = 0; i < 30 && q.empty; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    q = await db.collection("commissionPayouts").where("repId", "==", REP).get();
  }
  if (q.empty) {
    console.log("\n⏳ No payout batch yet — the scheduler may not have run. Seed left intact; re-run the check (or re-trigger).\n");
    process.exit(2);
  }
  let ok = true;
  const mark = (label, pass) => { console.log(`  ${pass ? "✓" : "✗"} ${label}`); if (!pass) ok = false; };

  console.log("\n  PAYOUT BATCH:");
  mark("exactly one payout batch for the rep", q.size === 1);
  const batch = q.docs[0]?.data();
  if (batch) {
    mark(`status == paid (was: ${batch.status})`, batch.status === "paid");
    mark(`amountCents == ${EXPECTED_NET} (was: ${batch.amountCents})`, batch.amountCents === EXPECTED_NET);
    mark("stripeTransferId set", !!batch.stripeTransferId);
    mark("commissionIds has both entries", (batch.commissionIds ?? []).length === 2);
  }
  const c1 = (await db.doc(`commissions/${C1}`).get()).data();
  const c2 = (await db.doc(`commissions/${C2}`).get()).data();
  console.log("\n  LEDGER:");
  mark("c1 flipped to paid + stamped batch", c1?.status === "paid" && !!c1?.payoutBatchId);
  mark("c2 flipped to paid + stamped batch", c2?.status === "paid" && !!c2?.payoutBatchId);

  console.log(ok ? "\n✅ PASS — rep payout verified end-to-end.\n" : "\n❌ FAIL / not-yet — see above (did the trigger run?).\n");

  // Cleanup (read the rep acct id before deleting the doc).
  const repDoc = (await db.doc(`users/${REP}`).get()).data();
  const acctId = repDoc?.salesRep?.payouts?.stripeAccountId;
  await Promise.all([
    db.doc(`commissions/${C1}`).delete(),
    db.doc(`commissions/${C2}`).delete(),
    ...q.docs.map((d) => d.ref.delete()),
    db.doc(`users/${REP}`).delete(),
  ]).catch(() => {});
  if (acctId) await stripe.accounts.del(acctId).catch(() => {});
  console.log("✔ Cleaned up.");
  process.exit(ok ? 0 : 1);
}

(phase === "seed" ? seed() : check()).catch((err) => {
  console.error("\n✖ Verification error:", err?.message ?? err);
  process.exit(1);
});
