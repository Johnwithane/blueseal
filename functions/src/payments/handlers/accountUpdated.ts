// `account.updated` — Stripe's notification that a Connect account's
// onboarding / capabilities / requirements state has changed. We mirror the
// relevant slice onto `tradespeople/{uid}.payouts` so the in-app payouts
// view reflects truth without polling.

import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../../lib/admin";
import type { StripeAccount } from "./shared";

type ConnectOnboardingStatus =
  | "not_started"
  | "in_progress"
  | "restricted"
  | "enabled";

interface MirroredPayoutsState {
  stripeAccountId: string;
  onboardingStatus: ConnectOnboardingStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  pendingRequirements: string[];
  lastSyncedAt: FieldValue;
}

function deriveStatus(account: StripeAccount): ConnectOnboardingStatus {
  if (account.payouts_enabled && account.charges_enabled) return "enabled";
  if (account.requirements?.disabled_reason) return "restricted";
  if (
    (account.requirements?.currently_due?.length ?? 0) > 0 ||
    !account.details_submitted
  ) {
    return "in_progress";
  }
  return "restricted";
}

function mirror(account: StripeAccount): MirroredPayoutsState {
  return {
    stripeAccountId: account.id,
    onboardingStatus: deriveStatus(account),
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
    disabledReason: account.requirements?.disabled_reason ?? null,
    pendingRequirements: [
      ...(account.requirements?.currently_due ?? []),
      ...(account.requirements?.past_due ?? []),
    ],
    lastSyncedAt: FieldValue.serverTimestamp(),
  };
}

// A rep's Connect account is transfers-only (they receive their commission
// payout, never take card charges), so `charges_enabled` stays false and the
// tradesperson `deriveStatus` — which needs BOTH charges + payouts for "enabled"
// — would wrongly read "restricted". Derive a rep's status from payout
// readiness alone.
function deriveRepStatus(account: StripeAccount): ConnectOnboardingStatus {
  if (account.payouts_enabled) return "enabled";
  if (account.requirements?.disabled_reason) return "restricted";
  if (
    (account.requirements?.currently_due?.length ?? 0) > 0 ||
    !account.details_submitted
  ) {
    return "in_progress";
  }
  return "restricted";
}

// A sales rep's Connect account carries `metadata.repId` (set by
// createRepConnectAccount). Mirror the same payouts slice onto
// `users/{uid}.salesRep.payouts`. Deep-merge keeps the rep's other salesRep
// fields (referralCode, active, liability) intact. Rep accounts are new in M6,
// so they always have the metadata round-trip — no legacy fallback query needed.
async function handleRepAccountUpdated(
  account: StripeAccount,
  repId: string,
): Promise<void> {
  const ref = db.doc(`users/${repId}`);
  const snap = await ref.get();
  if (!snap.exists || !snap.data()?.salesRep) {
    logger.warn("stripeWebhook account.updated: rep metadata uid missing salesRep", {
      accountId: account.id,
      repId,
    });
    return;
  }
  const payouts = { ...mirror(account), onboardingStatus: deriveRepStatus(account) };
  await ref.set({ salesRep: { payouts } }, { merge: true });
  logger.info("stripeWebhook account.updated: rep payouts mirrored", {
    accountId: account.id,
    repId,
    onboardingStatus: payouts.onboardingStatus,
  });
}

// A PM's Connect account carries `metadata.pmId` (set by createPmConnectAccount).
// Transfers-only like a rep, so it shares deriveRepStatus (payout-readiness alone).
// Mirrors onto `users/{uid}.projectManager.payouts`.
async function handlePmAccountUpdated(
  account: StripeAccount,
  pmId: string,
): Promise<void> {
  const ref = db.doc(`users/${pmId}`);
  const snap = await ref.get();
  if (!snap.exists || !snap.data()?.projectManager) {
    logger.warn("stripeWebhook account.updated: pm metadata uid missing projectManager", {
      accountId: account.id,
      pmId,
    });
    return;
  }
  const payouts = { ...mirror(account), onboardingStatus: deriveRepStatus(account) };
  await ref.set({ projectManager: { payouts } }, { merge: true });
  logger.info("stripeWebhook account.updated: pm payouts mirrored", {
    accountId: account.id,
    pmId,
    onboardingStatus: payouts.onboardingStatus,
  });
}

export async function handleAccountUpdated(
  account: StripeAccount,
): Promise<void> {
  // A rep Connect account (metadata.repId) mirrors to salesRep; a PM account
  // (metadata.pmId) to projectManager; everything else is a tradesperson account.
  const repId = account.metadata?.repId;
  if (repId) {
    await handleRepAccountUpdated(account, repId);
    return;
  }
  const pmId = account.metadata?.pmId;
  if (pmId) {
    await handlePmAccountUpdated(account, pmId);
    return;
  }

  // Prefer the metadata round-trip set during `createConnectAccount`. Fall
  // back to a `where payouts.stripeAccountId == account.id` query so we
  // still cope with accounts created before the metadata round-trip
  // existed (legacy / manual creations via the Stripe dashboard).
  const metaUid = account.metadata?.tradespersonId;
  let tradieRef = metaUid ? db.doc(`tradespeople/${metaUid}`) : null;

  if (tradieRef) {
    const snap = await tradieRef.get();
    if (!snap.exists) {
      logger.warn("stripeWebhook account.updated: metadata uid missing doc", {
        accountId: account.id,
        metaUid,
      });
      tradieRef = null;
    }
  }

  if (!tradieRef) {
    const query = await db
      .collection("tradespeople")
      .where("payouts.stripeAccountId", "==", account.id)
      .limit(1)
      .get();
    if (query.empty) {
      logger.warn(
        "stripeWebhook account.updated: no tradesperson for account",
        { accountId: account.id },
      );
      return;
    }
    tradieRef = query.docs[0].ref;
  }

  await tradieRef.set({ payouts: mirror(account) }, { merge: true });
  logger.info("stripeWebhook account.updated: mirrored", {
    accountId: account.id,
    uid: tradieRef.id,
  });
}
