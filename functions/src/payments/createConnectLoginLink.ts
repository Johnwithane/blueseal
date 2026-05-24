// Returns a single-use Stripe Express dashboard login link for the calling
// tradesperson. Used from the in-app Payouts view so the tradie can manage
// their bank account, see payout history, download tax docs — all the
// stuff Stripe's hosted dashboard provides, without leaving the Blue Seal
// experience for a separate login.
//
// Only callable once the Connect account is enabled (`details_submitted`
// flips true after onboarding); Stripe returns 400 before then.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";

export const createConnectLoginLink = onCall(
  { secrets: [STRIPE_SECRET_KEY], enforceAppCheck: false },
  async (req) => {
    const uid = requireRole(req, "tradesperson");

    const snap = await db.doc(`tradespeople/${uid}`).get();
    const payouts = snap.data()?.payouts as
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

    logger.info("createConnectLoginLink", {
      uid,
      accountId: payouts.stripeAccountId,
    });
    return { url: link.url };
  },
);
