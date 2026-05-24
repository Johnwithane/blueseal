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

// Platform fee in basis points (12% = 1200 bps). Configurable so we can
// tune the take rate (or run promotional periods) without a code deploy.
// Snapshot per-invoice in `InvoicePaymentState.applicationFeeBps` at
// send-time so historical invoices stay auditable when this changes.
export const PLATFORM_FEE_BPS = defineString("PLATFORM_FEE_BPS", {
  default: "1200",
});

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

// Default empty PayoutsState seeded onto a tradesperson doc the first time
// they kick off Stripe Connect onboarding. Mirrored by the
// `account.updated` webhook from that point forward.
export function emptyPayoutsState(): {
  stripeAccountId: null;
  onboardingStatus: "not_started";
  chargesEnabled: false;
  payoutsEnabled: false;
  detailsSubmitted: false;
  disabledReason: null;
  pendingRequirements: string[];
  lastSyncedAt: null;
} {
  return {
    stripeAccountId: null,
    onboardingStatus: "not_started",
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    disabledReason: null,
    pendingRequirements: [],
    lastSyncedAt: null,
  };
}
