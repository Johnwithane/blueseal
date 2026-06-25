// Single-use Stripe Express dashboard login link for the calling sales rep, so
// they can manage their bank account + see payout history without leaving Blue
// Seal. Mirror of the tradesperson `createConnectLoginLink`, reading the rep's
// account from `users/{uid}.salesRep.payouts`. Only callable once onboarding has
// submitted details (Stripe 400s before then).

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requireRepActive } from "../lib/salesRep";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";

export const createRepConnectLoginLink = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "sales");
    await requireRepActive(uid);

    const snap = await db.doc(`users/${uid}`).get();
    const payouts = snap.data()?.salesRep?.payouts as
      | { stripeAccountId?: string; detailsSubmitted?: boolean }
      | undefined;
    if (!payouts?.stripeAccountId) {
      throw new HttpsError(
        "failed-precondition",
        "Create a Stripe Connect account first.",
      );
    }
    if (!payouts.detailsSubmitted) {
      throw new HttpsError(
        "failed-precondition",
        "Complete Stripe onboarding before accessing the dashboard.",
      );
    }

    const stripe = getStripe();
    const link = await stripe.accounts.createLoginLink(payouts.stripeAccountId);

    logger.info("createRepConnectLoginLink", {
      uid,
      accountId: payouts.stripeAccountId,
    });
    return { url: link.url };
  },
);
