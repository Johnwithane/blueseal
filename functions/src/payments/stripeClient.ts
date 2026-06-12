// Single Stripe SDK instance shared across all callables and the webhook
// dispatcher. Secrets are declared here and re-exported so each function
// that uses Stripe can list them in its options without typo-prone
// duplicate `defineSecret(...)` calls.
//
// Lazy-init: `getStripe()` defers the SDK construction until first use so
// the SDK doesn't require `STRIPE_SECRET_KEY` to be resolvable at module
// load time. This matters for unit tests and for the function emulator
// when secrets aren't bound.
//
// `apiVersion` is pinned to match the version baked into the installed SDK.
// Bump only intentionally (and in lock-step with `stripe@<x>` upgrade) —
// auto-resolving "your account's current version" leaks deploy-time
// behavior changes into already-running code.

import Stripe from "stripe";
import { defineSecret, defineString } from "firebase-functions/params";

export const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
export const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

// Blue Seal Pro price ids (the Stripe Price objects created by
// functions/scripts/stripe-setup.mjs). Non-secret config — set on the functions
// runtime (functions/.env locally; the deploy bakes them in). These are
// account-specific, so they differ between the test and live Stripe accounts.
export const STRIPE_PRICE_PRO_MONTHLY = defineString("STRIPE_PRICE_PRO_MONTHLY");
export const STRIPE_PRICE_PRO_ANNUAL = defineString("STRIPE_PRICE_PRO_ANNUAL");

// NOTE: the old flat 12% commission (PLATFORM_FEE_BPS) is gone. The platform
// take is now the Blue Seal service fee — 5% of the invoice, $2 floor, capped
// $99 per job, waived for Pro — computed in ./serviceFee.ts and charged to the
// client on top of the invoice (the tradesperson nets the full invoice total).

// `Stripe.Account` / `Stripe.Event` aren't surfaced through stripe@22's CJS
// types entrypoint (only the constructor is). `InstanceType<typeof Stripe>`
// recovers the instance type; resource shapes we touch get small local
// interfaces in the consuming file. Bumping past the CJS limitation by
// switching the project to ESM module emit is out of scope here.
export type StripeClient = InstanceType<typeof Stripe>;

const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;

let _stripe: StripeClient | null = null;

export function getStripe(): StripeClient {
  if (!_stripe) {
    _stripe = new Stripe(STRIPE_SECRET_KEY.value(), {
      apiVersion: STRIPE_API_VERSION,
      typescript: true,
      // Identify Blue Seal traffic in Stripe's logs.
      appInfo: { name: "blueseal", version: "1.0.0" },
    });
  }
  return _stripe;
}

// emptyPayoutsState lives in ./payoutsState so callers that only need the
// default shape don't transitively trigger `defineSecret()` here. Re-export
// for back-compat with existing Stripe callers (webhook, callables).
export { emptyPayoutsState } from "./payoutsState";
