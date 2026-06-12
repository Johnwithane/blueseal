// Verifies the Blue Seal Pro subscription webhook path against the REAL
// deployed webhook + Firestore (test mode): create a trialing subscription via
// the Stripe API with metadata.uid → the customer.subscription.created webhook
// should sync users/{uid}.subscription.status = "trialing" + tradespeople/
// {uid}.isPro = true. Then cancel → isPro false. Cleans up.
//
//   STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_PRO_MONTHLY=price_... node functions/scripts/verify-subscription.mjs

import Stripe from "stripe";
import admin from "firebase-admin";

const key = process.env.STRIPE_SECRET_KEY;
const price = process.env.STRIPE_PRICE_PRO_MONTHLY;
if (!key?.startsWith("sk_test_") || !price?.startsWith("price_")) {
  console.error("✖ Set STRIPE_SECRET_KEY (sk_test_) and STRIPE_PRICE_PRO_MONTHLY (price_).");
  process.exit(1);
}
const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
admin.initializeApp({ projectId: "blueseal-762af" });
const db = admin.firestore();

const UID = "verify-prosub-claude";
let customer, sub;

async function waitFor(predicate, label) {
  for (let i = 0; i < 30; i++) {
    const u = (await db.doc(`users/${UID}`).get()).data();
    const t = (await db.doc(`tradespeople/${UID}`).get()).data();
    if (predicate(u, t)) return { u, t };
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function cleanup() {
  if (sub) await stripe.subscriptions.cancel(sub.id).catch(() => {});
  if (customer) await stripe.customers.del(customer.id).catch(() => {});
  await Promise.all([
    db.doc(`users/${UID}`).delete(),
    db.doc(`tradespeople/${UID}`).delete(),
  ]).catch(() => {});
  console.log("✔ Cleaned up.");
}

async function main() {
  console.log("\n▶ Verifying Blue Seal Pro subscription webhook (test mode)\n");
  try {
    await db.doc(`users/${UID}`).set({ displayName: "Verify ProSub", email: `${UID}@example.com`, roles: ["tradesperson"] }, { merge: true });
    await db.doc(`tradespeople/${UID}`).set({ displayName: "Verify ProSub", isVisible: false }, { merge: true });

    customer = await stripe.customers.create({ email: `${UID}@example.com`, metadata: { uid: UID } });
    sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price }],
      trial_period_days: 30,
      metadata: { uid: UID },
    });
    console.log(`✔ Created trialing subscription ${sub.id}`);

    const trialing = await waitFor(
      (u, t) => u?.subscription?.status === "trialing" && t?.isPro === true,
      "subscription trialing + isPro true",
    );
    console.log(`  ✓ users/${UID}.subscription.status == trialing`);
    console.log(`  ✓ users/${UID}.subscription.plan == ${trialing.u.subscription.plan}`);
    console.log(`  ✓ tradespeople/${UID}.isPro == true`);

    await stripe.subscriptions.cancel(sub.id);
    sub = null;
    await waitFor(
      (u, t) => u?.subscription?.status === "canceled" && t?.isPro !== true,
      "subscription canceled + isPro false",
    );
    console.log(`  ✓ after cancel: subscription canceled + isPro false`);

    console.log("\n✅ PASS — subscription webhook sync verified end-to-end.\n");
    await cleanup();
    process.exit(0);
  } catch (err) {
    console.error("\n✖ Verification error:", err?.message ?? err);
    await cleanup();
    process.exit(1);
  }
}

main();
