// Returns a single-use Stripe Express dashboard login link for the calling
// tradesperson. Used from the in-app Payouts view so the tradie can manage
// their bank account, see payout history, download tax docs — all the
// stuff Stripe's hosted dashboard provides, without leaving the Blue Seal
// experience for a separate login.
//
// Only callable once the Connect account is enabled (`details_submitted`
// flips true after onboarding); Stripe returns 400 before then.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";
import { clearOrphanedAccount } from "./connectAccount";
import { isMissingResource, stripeFailure } from "./connectErrors";

export const createConnectLoginLink = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "tradesperson");
    const ctx = { fn: "createConnectLoginLink", uid };

    const tradieRef = db.doc(`tradespeople/${uid}`);
    const snap = await tradieRef.get();
    const payouts = snap.data()?.payouts as
      | { stripeAccountId?: string; detailsSubmitted?: boolean }
      | undefined;
    if (!payouts?.stripeAccountId) {
      throw new HttpsError("failed-precondition", "Create a Stripe Connect account first.");
    }
    if (!payouts.detailsSubmitted) {
      throw new HttpsError(
        "failed-precondition",
        "Complete Stripe onboarding before accessing the dashboard.",
      );
    }

    const accountId = payouts.stripeAccountId;
    const stripe = getStripe();
    try {
      const link = await stripe.accounts.createLoginLink(accountId);
      logger.info("createConnectLoginLink", { ...ctx, accountId });
      return { url: link.url };
    } catch (err) {
      if (isMissingResource(err)) {
        await clearOrphanedAccount(tradieRef, "payouts", ctx);
      }
      throw stripeFailure(err, { ...ctx, accountId });
    }
  },
);
