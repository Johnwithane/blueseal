// Creates a Stripe Connect Express account for the calling sales rep on first
// call; idempotent afterward (returns the existing account id). Mirror of the
// tradesperson `createConnectAccount`, but for a rep: the payout state lives on
// `users/{uid}.salesRep.payouts`, and the Stripe account carries `metadata.repId`
// so the `account.updated` webhook can route the mirror to the right doc.
//
// A rep only ever RECEIVES transfers (their monthly commission payout), never
// takes card payments, so only the `transfers` capability is requested. The rep
// must be active + have signed the current liability agreement before onboarding
// payouts (requireRepActive).

import { onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requireRepActive } from "../lib/salesRep";
import { STRIPE_SECRET_KEY, emptyPayoutsState, getStripe } from "./stripeClient";

interface ExistingPayouts {
  stripeAccountId?: string | null;
}

export const createRepConnectAccount = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "sales");
    await requireRepActive(uid);

    const repRef = db.doc(`users/${uid}`);
    const snap = await repRef.get();
    const existing = (snap.data()?.salesRep?.payouts ?? {}) as ExistingPayouts;
    if (existing.stripeAccountId) {
      logger.info("createRepConnectAccount: idempotent hit", {
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
      // repId round-trip for the webhook dispatcher (distinguishes a rep account
      // from a tradesperson one, which carries metadata.tradespersonId).
      metadata: { repId: uid },
    });

    await repRef.set(
      {
        salesRep: {
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

    logger.info("createRepConnectAccount: created", {
      uid,
      stripeAccountId: account.id,
    });
    return { stripeAccountId: account.id };
  },
);
