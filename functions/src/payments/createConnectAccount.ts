// Creates a Stripe Connect Express account for the calling tradesperson on
// first call; idempotent on every subsequent call (returns the existing
// account id). This is the entry point of the Connect onboarding flow —
// follow up with `createConnectOnboardingLink` to get the hosted form URL.
//
// Country + currency are hardcoded to Canada per the launch market. When
// Blue Seal expands beyond CA, source these from the tradesperson's
// primary address — but anything other than CA requires Stripe's
// country-specific capability + agreement matrix, not a one-line change.
//
// The tradesperson's uid is stored on the Stripe account's `metadata` so
// the webhook dispatcher can locate the Firestore doc to mirror state
// onto without a query.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import {
  STRIPE_SECRET_KEY,
  emptyPayoutsState,
  getStripe,
} from "./stripeClient";

interface ExistingPayouts {
  stripeAccountId?: string | null;
  onboardingStatus?: string;
}

export const createConnectAccount = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "tradesperson");

    const tradieRef = db.doc(`tradespeople/${uid}`);
    const snap = await tradieRef.get();
    if (!snap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Complete your tradesperson profile before connecting Stripe.",
      );
    }

    const existing = (snap.data()?.payouts ?? {}) as ExistingPayouts;
    if (existing.stripeAccountId) {
      logger.info("createConnectAccount: idempotent hit", {
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
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: "individual",
      // uid round-trip for the webhook dispatcher.
      metadata: { tradespersonId: uid },
    });

    await tradieRef.set(
      {
        payouts: {
          ...emptyPayoutsState(),
          stripeAccountId: account.id,
          onboardingStatus: "in_progress",
          lastSyncedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );

    logger.info("createConnectAccount: created", {
      uid,
      stripeAccountId: account.id,
    });
    return { stripeAccountId: account.id };
  },
);
