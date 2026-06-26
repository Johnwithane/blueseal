// Creates a Stripe Connect Express account for the calling project manager on
// first call; idempotent afterward. Mirror of createRepConnectAccount: the payout
// state lives on `users/{uid}.projectManager.payouts`, and the Stripe account
// carries `metadata.pmId` so the `account.updated` webhook routes the mirror to the
// right doc. A PM only ever RECEIVES transfers (their monthly commission payout),
// so only the `transfers` capability is requested. The PM must be active AND have
// signed the current liability agreement before onboarding payouts.

import { onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requirePmActive, assertPmAgreementSigned } from "../lib/projectManager";
import { STRIPE_SECRET_KEY, emptyPayoutsState, getStripe } from "./stripeClient";

interface ExistingPayouts {
  stripeAccountId?: string | null;
}

export const createPmConnectAccount = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "projectManager");
    assertPmAgreementSigned(await requirePmActive(uid));

    const pmRef = db.doc(`users/${uid}`);
    const snap = await pmRef.get();
    const existing = (snap.data()?.projectManager?.payouts ?? {}) as ExistingPayouts;
    if (existing.stripeAccountId) {
      logger.info("createPmConnectAccount: idempotent hit", {
        uid,
        stripeAccountId: existing.stripeAccountId,
      });
      return { stripeAccountId: existing.stripeAccountId };
    }

    const stripe = getStripe();
    const account = await stripe.accounts.create({
      type: "express",
      country: "CA",
      default_currency: "cad",
      capabilities: {
        transfers: { requested: true },
      },
      business_type: "individual",
      // pmId round-trip for the webhook dispatcher (distinguishes a PM account
      // from a rep one (metadata.repId) or a tradesperson one).
      metadata: { pmId: uid },
    });

    await pmRef.set(
      {
        projectManager: {
          payouts: {
            ...emptyPayoutsState(),
            stripeAccountId: account.id,
            onboardingStatus: "in_progress",
            lastSyncedAt: FieldValue.serverTimestamp(),
          },
        },
      },
      { merge: true },
    );

    logger.info("createPmConnectAccount: created", { uid, stripeAccountId: account.id });
    return { stripeAccountId: account.id };
  },
);
