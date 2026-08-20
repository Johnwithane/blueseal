// Single-use Stripe Express dashboard login link for the calling project manager,
// so they can manage their bank account + see payout history without leaving Blue
// Seal. Mirror of createRepConnectLoginLink, reading the PM's account from
// `users/{uid}.projectManager.payouts`. Only callable once onboarding has submitted
// details (Stripe 400s before then).

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requirePmActive } from "../lib/projectManager";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";
import { clearOrphanedAccount } from "./connectAccount";
import { isMissingResource, stripeFailure } from "./connectErrors";

export const createPmConnectLoginLink = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "projectManager");
    await requirePmActive(uid);

    const ctx = { fn: "createPmConnectLoginLink", uid };
    const pmRef = db.doc(`users/${uid}`);
    const snap = await pmRef.get();
    const payouts = snap.data()?.projectManager?.payouts as
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
      logger.info("createPmConnectLoginLink", { ...ctx, accountId });
      return { url: link.url };
    } catch (err) {
      // A stored id the current Stripe key cannot see is an orphan from the
      // pre-cutover sandbox account. Drop it so the next click starts a clean
      // onboarding instead of re-hitting this same 404 forever.
      if (isMissingResource(err)) {
        await clearOrphanedAccount(pmRef, "projectManager.payouts", ctx);
      }
      throw stripeFailure(err, { ...ctx, accountId });
    }
  },
);
