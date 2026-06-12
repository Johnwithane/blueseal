// Returns a Stripe Customer Portal URL so a Pro tradesperson can manage their
// subscription (cancel at period end, switch monthly↔annual, update card). The
// portal configuration is set up by functions/scripts/stripe-setup.mjs.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import type { SubscriptionState } from "../lib/subscription";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://blueseal.app").replace(/\/$/, "");
}

export const createBillingPortalSession = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "tradesperson");

    const snap = await db.doc(`users/${uid}`).get();
    const sub = (snap.data()?.subscription ?? null) as SubscriptionState | null;
    if (!sub?.stripeCustomerId) {
      throw new HttpsError(
        "failed-precondition",
        "No subscription to manage yet — start Blue Seal Pro first.",
      );
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${appBaseUrl()}/account?tab=pro`,
    });

    logger.info("createBillingPortalSession", { uid });
    return { url: session.url };
  },
);
