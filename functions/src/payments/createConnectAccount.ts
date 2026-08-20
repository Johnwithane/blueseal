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
//
// "Idempotent" is now verified rather than assumed: a stored id that the
// current Stripe key can't see is an orphan from the pre-cutover sandbox
// account, and returning it would dead-end onboarding permanently. See
// connectAccount.ts.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { STRIPE_SECRET_KEY, emptyPayoutsState, getStripe } from "./stripeClient";
import { applyPayoutHold, connectAccountExists } from "./connectAccount";
import { callStripe } from "./connectErrors";

interface ExistingPayouts {
  stripeAccountId?: string | null;
  onboardingStatus?: string;
}

export const createConnectAccount = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireRole(req, "tradesperson");
    const ctx = { fn: "createConnectAccount", uid };

    const tradieRef = db.doc(`tradespeople/${uid}`);
    const snap = await tradieRef.get();
    if (!snap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Complete your tradesperson profile before connecting Stripe.",
      );
    }

    const stripe = getStripe();
    const existing = (snap.data()?.payouts ?? {}) as ExistingPayouts;
    if (existing.stripeAccountId) {
      const stored = existing.stripeAccountId;
      const alive = await callStripe(ctx, () => connectAccountExists(stripe, stored, ctx));
      if (alive) {
        logger.info("createConnectAccount: idempotent hit", {
          ...ctx,
          stripeAccountId: stored,
        });
        return { stripeAccountId: stored };
      }
      // Orphan: the id points into a Stripe account this key can't reach, so
      // there's no live account and no money behind it. Fall through and mint a
      // real one rather than handing back an id every later call will 404 on.
      logger.warn("createConnectAccount: replacing orphaned account id", {
        ...ctx,
        orphanedAccountId: stored,
      });
    }

    const account = await callStripe(ctx, () =>
      stripe.accounts.create({
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
      }),
    );

    // Separate, non-blocking step — a rejected settings hash must never stop a
    // tradesperson onboarding. See applyPayoutHold.
    const payoutHoldDays = await applyPayoutHold(stripe, account.id, ctx);

    await tradieRef.set(
      {
        payouts: {
          ...emptyPayoutsState(),
          stripeAccountId: account.id,
          onboardingStatus: "in_progress",
          payoutHoldDays,
          lastSyncedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );

    logger.info("createConnectAccount: created", {
      ...ctx,
      stripeAccountId: account.id,
      payoutHoldDays,
    });
    return { stripeAccountId: account.id };
  },
);
