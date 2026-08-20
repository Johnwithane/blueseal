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
import { clearOrphanedAccount } from "./connectAccount";
import { isMissingResource, stripeFailure } from "./connectErrors";

export const createRepConnectLoginLink = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "sales");
    await requireRepActive(uid);

    const ctx = { fn: "createRepConnectLoginLink", uid };
    const repRef = db.doc(`users/${uid}`);
    const snap = await repRef.get();
    const payouts = snap.data()?.salesRep?.payouts as
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
      logger.info("createRepConnectLoginLink", { ...ctx, accountId });
      return { url: link.url };
    } catch (err) {
      // A stored id the current Stripe key cannot see is an orphan from the
      // pre-cutover sandbox account. Drop it so the next click starts a clean
      // onboarding instead of re-hitting this same 404 forever.
      if (isMissingResource(err)) {
        await clearOrphanedAccount(repRef, "salesRep.payouts", ctx);
      }
      throw stripeFailure(err, { ...ctx, accountId });
    }
  },
);
