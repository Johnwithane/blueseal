// Returns a fresh, short-lived Stripe Connect Express onboarding link for
// the calling tradesperson. The link expires (Stripe rotates it within ~5
// minutes of generation), so the UI should call this on each click rather
// than caching the URL.
//
// `refresh_url` is hit when the link expires before the tradesperson
// completes the form — Stripe redirects there and we call this callable
// again to mint a fresh link. `return_url` is hit when they finish — we
// land them on the payouts onboarding view so they can see their state
// (which the `account.updated` webhook will have just refreshed).
//
// Both URLs are derived from `APP_BASE_URL` (the env var already used by
// notify.ts) so dev / staging / prod each route to the right host.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";

function appBaseUrl(): string {
  const raw = process.env.APP_BASE_URL ?? "https://blueseal.app";
  return raw.replace(/\/$/, "");
}

export const createConnectOnboardingLink = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "tradesperson");

    const snap = await db.doc(`tradespeople/${uid}`).get();
    const accountId = snap.data()?.payouts?.stripeAccountId as
      | string
      | undefined;
    if (!accountId) {
      throw new HttpsError(
        "failed-precondition",
        "Create a Stripe Connect account first.",
      );
    }

    const base = appBaseUrl();
    const stripe = getStripe();
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${base}/payouts/refresh`,
      return_url: `${base}/payouts/return`,
    });

    logger.info("createConnectOnboardingLink", { uid, accountId });
    return { url: link.url, expiresAt: link.expires_at };
  },
);
