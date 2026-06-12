// Idempotent Stripe bootstrap for Blue Seal Pro + the payment platform.
//
// Re-running is safe: every resource is looked up by a `blueseal` metadata tag
// (or by URL, for the webhook) before anything is created. Run it against a
// TEST key first, exercise the sandbox end-to-end, then run it again against
// the LIVE key for the production cutover. It only talks to the Stripe API and
// PRINTS the ids/secret you then feed to the Cloud Functions runtime — it never
// touches Firebase or your codebase.
//
// Lives under functions/ so it resolves the `stripe` SDK already installed
// there (the repo root doesn't depend on the server SDK). Run from the repo
// root:
//
//   # 1) products + prices + portal config (do this first, in test mode):
//   STRIPE_SECRET_KEY=sk_test_xxx node functions/scripts/stripe-setup.mjs
//
//   # 2) after deploying the stripeWebhook function, register the endpoint:
//   STRIPE_SECRET_KEY=sk_test_xxx \
//     WEBHOOK_URL=https://stripewebhook-xxxx-uc.a.run.app \
//     node functions/scripts/stripe-setup.mjs
//
// Env:
//   STRIPE_SECRET_KEY (required)  sk_test_… or sk_live_…
//   WEBHOOK_URL       (optional)  deployed stripeWebhook URL → registers the
//                                 endpoint + prints its signing secret
//   APP_BASE_URL      (optional)  portal return base; default https://blueseal.app

import Stripe from "stripe";

// Keep in lock-step with functions/src/payments/stripeClient.ts.
const API_VERSION = "2026-04-22.dahlia";
const TAG = "blueseal_pro"; // metadata marker for idempotent lookups

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("✖ STRIPE_SECRET_KEY is required (sk_test_… or sk_live_…).");
  process.exit(1);
}
const mode = key.startsWith("sk_live_") ? "LIVE" : "TEST";
const appBase = (process.env.APP_BASE_URL || "https://blueseal.app").replace(/\/$/, "");
const stripe = new Stripe(key, { apiVersion: API_VERSION });

async function ensureProduct() {
  const list = await stripe.products.list({ active: true, limit: 100 });
  const found = list.data.find((p) => p.metadata?.blueseal === TAG);
  if (found) return found;
  return stripe.products.create({
    name: "Blue Seal Pro",
    description:
      "AI assistant, zero client service fees, featured placement, and business reports.",
    metadata: { blueseal: TAG },
  });
}

async function ensurePrice(product, { interval, unitAmount, lookup }) {
  const list = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const found = list.data.find((p) => p.metadata?.blueseal_price === lookup);
  if (found) return found;
  return stripe.prices.create({
    product: product.id,
    currency: "cad",
    unit_amount: unitAmount,
    recurring: { interval },
    metadata: { blueseal_price: lookup },
  });
}

async function ensurePortalConfig(monthly, annual) {
  const list = await stripe.billingPortal.configurations.list({ limit: 100 });
  const found = list.data.find((c) => c.metadata?.blueseal === TAG);
  const params = {
    business_profile: {
      headline: "Manage your Blue Seal Pro subscription",
      privacy_policy_url: `${appBase}/privacy`,
      terms_of_service_url: `${appBase}/terms`,
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "missing_features", "switched_service", "unused", "other"],
        },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        products: [{ product: monthly.product, prices: [monthly.id, annual.id] }],
      },
    },
    metadata: { blueseal: TAG },
  };
  if (found) return stripe.billingPortal.configurations.update(found.id, params);
  return stripe.billingPortal.configurations.create(params);
}

// The full event set the dispatcher (functions/src/payments/stripeWebhook.ts)
// handles: Connect + payments (service fee) + subscription (Pro).
const WEBHOOK_EVENTS = [
  "account.updated",
  "payment_intent.processing",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "payout.created",
  "payout.paid",
  "payout.failed",
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
];

async function ensureWebhook(url) {
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const found = list.data.find((e) => e.url === url);
  if (found) {
    await stripe.webhookEndpoints.update(found.id, { enabled_events: WEBHOOK_EVENTS });
    return { endpoint: found, secret: null };
  }
  const endpoint = await stripe.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: "Blue Seal — payments + subscription",
    metadata: { blueseal: TAG },
  });
  return { endpoint, secret: endpoint.secret };
}

async function main() {
  console.log(`\n▶ Blue Seal Stripe setup — ${mode} mode (api ${API_VERSION})\n`);

  const product = await ensureProduct();
  console.log(`✔ Product: ${product.id} (${product.name})`);

  const monthly = await ensurePrice(product, {
    interval: "month",
    unitAmount: 2900,
    lookup: "pro_monthly",
  });
  const annual = await ensurePrice(product, {
    interval: "year",
    unitAmount: 29000,
    lookup: "pro_annual",
  });
  console.log(`✔ Monthly price: ${monthly.id}  ($29.00 CAD/mo)`);
  console.log(`✔ Annual  price: ${annual.id}  ($290.00 CAD/yr)`);

  const portal = await ensurePortalConfig(monthly, annual);
  console.log(`✔ Customer Portal config: ${portal.id}`);

  let webhook = null;
  const url = process.env.WEBHOOK_URL;
  if (url) {
    webhook = await ensureWebhook(url);
    console.log(`✔ Webhook endpoint: ${webhook.endpoint.id} → ${url}`);
  } else {
    console.log(
      "• WEBHOOK_URL not set — skipping webhook (re-run with it after deploying stripeWebhook).",
    );
  }

  console.log("\n─────────────────────────────────────────────");
  console.log("Set these as Cloud Functions runtime env params (NOT secrets):");
  console.log(`  STRIPE_PRICE_PRO_MONTHLY=${monthly.id}`);
  console.log(`  STRIPE_PRICE_PRO_ANNUAL=${annual.id}`);
  if (webhook?.secret) {
    console.log("\nSet the webhook signing secret (only shown now, on first creation):");
    console.log(`  firebase functions:secrets:set STRIPE_WEBHOOK_SECRET   # paste: ${webhook.secret}`);
  } else if (url) {
    console.log(
      "\n• Webhook already existed — Stripe won't re-reveal its signing secret via API.",
    );
    console.log(
      "  If it isn't saved, roll it in the Dashboard (Webhooks → endpoint → Roll secret) and set STRIPE_WEBHOOK_SECRET.",
    );
  }
  console.log("─────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("✖ Stripe setup failed:", err?.message ?? err);
  process.exit(1);
});
