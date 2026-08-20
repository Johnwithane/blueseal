// Helpers shared by the three Connect onboarding flows (tradesperson, project
// manager, sales rep). They all store a `stripeAccountId` on their own doc and
// all short-circuit on it, so they all share the same two hazards this file
// handles.

import { logger } from "firebase-functions/v2";

import type { StripeClient } from "./stripeClient";
import { emptyPayoutsState } from "./payoutsState";
import { isMissingResource, stripeErrorInfo } from "./connectErrors";

/**
 * Does the stored account id still resolve against the CURRENT Stripe key?
 *
 * The idempotency check in every `create*ConnectAccount` callable trusts the
 * stored id blindly, and the UI skips account creation whenever the mirrored
 * state has one. Together that means a stored id Stripe no longer recognises is
 * unrecoverable from inside the app: the create call hands the dead id straight
 * back, the very next `accountLinks.create` 404s, and the tradesperson is stuck
 * on that error forever with no button that does anything different.
 *
 * That is not hypothetical — the live cutover moved us to a *different* Stripe
 * account, so every sandbox `acct_` is dead against the live key. The Firestore
 * sweep at cutover cleared four tradesperson blocks by hand; anything it missed
 * (and the PM + rep blocks, which were never swept) is bricked exactly this way.
 *
 * So: verify before trusting. Returns false only for a genuine 404 — any other
 * Stripe failure throws, because "Stripe is down" must not be mistaken for
 * "this account is gone" and trigger a needless second account.
 */
export async function connectAccountExists(
  stripe: StripeClient,
  accountId: string,
  ctx: Record<string, unknown>,
): Promise<boolean> {
  try {
    await stripe.accounts.retrieve(accountId);
    return true;
  } catch (err) {
    if (isMissingResource(err)) {
      logger.warn("connect account not found on the current Stripe key", {
        ...ctx,
        accountId,
      });
      return false;
    }
    throw err;
  }
}

/**
 * Days a tradesperson's payout is held in their connected account before Stripe
 * sends it to their bank. We take destination charges, so Blue Seal is merchant
 * of record and a client chargeback lands on the PLATFORM balance — the hold
 * keeps the funds reversible instead of us eating the loss. Tradespeople can't
 * shorten it: Connect → Payouts → "Allow accounts to manage their payout
 * schedule" is off at the platform level.
 *
 * PM + rep accounts deliberately have no hold: their money is commission paid
 * from Blue Seal's own balance on a monthly batch, so there's nothing to claw
 * back.
 */
export const PAYOUT_HOLD_DAYS = 7;

/**
 * Apply the payout hold as its own step, AFTER the account exists.
 *
 * It used to ride along in the `accounts.create` payload, which coupled a
 * revenue-protection setting to the one call that must never fail: if Stripe
 * objected to the settings hash for any reason, the tradesperson couldn't
 * onboard at all. That hash went live in the cutover commit and — per
 * HUMANTASKS Stage 3 — live Connect onboarding was never exercised afterward,
 * so it was the one unverified input on the path that broke.
 *
 * Splitting it costs one extra API call per tradesperson, ever. In exchange a
 * rejection degrades to "onboarding works, hold didn't apply" instead of
 * "nobody can onboard". It is NOT silent: we log an error and return null so
 * the caller records the miss on the payouts block, because losing the hold
 * unnoticed is its own money risk.
 *
 * Returns the applied hold in days, or null if Stripe rejected it.
 */
export async function applyPayoutHold(
  stripe: StripeClient,
  accountId: string,
  ctx: Record<string, unknown>,
): Promise<number | null> {
  try {
    await stripe.accounts.update(accountId, {
      settings: {
        payouts: {
          schedule: { interval: "daily", delay_days: PAYOUT_HOLD_DAYS },
        },
      },
    });
    return PAYOUT_HOLD_DAYS;
  } catch (err) {
    // Deliberately swallowed: see the doc comment. Logged at error level so it
    // surfaces in monitoring rather than vanishing.
    logger.error("failed to apply the payout hold; account left on Stripe's default schedule", {
      ...ctx,
      accountId,
      holdDays: PAYOUT_HOLD_DAYS,
      stripe: stripeErrorInfo(err),
    });
    return null;
  }
}

/** The three doc locations a Connect payouts block lives at. */
export type PayoutsPath = "payouts" | "projectManager.payouts" | "salesRep.payouts";

/**
 * Reset a payouts block whose stored account id turned out to be an orphan, so
 * the next click starts a clean onboarding instead of re-hitting the same 404.
 *
 * Only ever called after `isMissingResource` — i.e. Stripe told us the id
 * doesn't exist on this key, so there is no live account (and no balance) being
 * detached from the user here.
 */
export async function clearOrphanedAccount(
  ref: FirebaseFirestore.DocumentReference,
  path: PayoutsPath,
  ctx: Record<string, unknown>,
): Promise<void> {
  const payload = path
    .split(".")
    .reduceRight<Record<string, unknown>>((inner, key) => ({ [key]: inner }), emptyPayoutsState());
  await ref.set(payload, { merge: true });
  logger.warn("cleared orphaned connect account id", { ...ctx, path });
}
