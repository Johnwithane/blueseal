// Fresh, short-lived Stripe Connect Express onboarding link for the calling
// sales rep. Mirror of the tradesperson `createConnectOnboardingLink`, reading
// the rep's account id from `users/{uid}.salesRep.payouts`. The UI should call
// this on each click (Stripe rotates the link within ~5 minutes).
//
// refresh_url / return_url land on the rep payouts views under /sales. (M7 adds
// those routes + the UI that calls this callable; for M6 the backend ships first.)

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requireRepActive } from "../lib/salesRep";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";

function appBaseUrl(): string {
  const raw = process.env.APP_BASE_URL ?? "https://blueseal.app";
  return raw.replace(/\/$/, "");
}

export const createRepConnectOnboardingLink = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "sales");
    await requireRepActive(uid);

    const snap = await db.doc(`users/${uid}`).get();
    const accountId = snap.data()?.salesRep?.payouts?.stripeAccountId as
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
      refresh_url: `${base}/sales/payouts/refresh`,
      return_url: `${base}/sales/payouts/return`,
    });

    logger.info("createRepConnectOnboardingLink", { uid, accountId });
    return { url: link.url, expiresAt: link.expires_at };
  },
);
