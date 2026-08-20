// Fresh, short-lived Stripe Connect Express onboarding link for the calling
// project manager. Mirror of createRepConnectOnboardingLink, reading the PM's
// account id from `users/{uid}.projectManager.payouts`. The UI calls this on each
// click (Stripe rotates the link within ~5 minutes). refresh_url / return_url land
// on the PM payouts views under /manage.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requirePmActive, assertPmAgreementSigned } from "../lib/projectManager";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";
import { clearOrphanedAccount } from "./connectAccount";
import { isMissingResource, stripeFailure } from "./connectErrors";

function appBaseUrl(): string {
  const raw = process.env.APP_BASE_URL ?? "https://blueseal.app";
  return raw.replace(/\/$/, "");
}

export const createPmConnectOnboardingLink = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "projectManager");
    assertPmAgreementSigned(await requirePmActive(uid));

    const ctx = { fn: "createPmConnectOnboardingLink", uid };
    const pmRef = db.doc(`users/${uid}`);
    const snap = await pmRef.get();
    const accountId = snap.data()?.projectManager?.payouts?.stripeAccountId as string | undefined;
    if (!accountId) {
      throw new HttpsError("failed-precondition", "Create a Stripe Connect account first.");
    }

    const base = appBaseUrl();
    const stripe = getStripe();
    try {
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        refresh_url: `${base}/manage/payouts/refresh`,
        return_url: `${base}/manage/payouts/return`,
      });
      logger.info("createPmConnectOnboardingLink", { ...ctx, accountId });
      return { url: link.url, expiresAt: link.expires_at };
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
