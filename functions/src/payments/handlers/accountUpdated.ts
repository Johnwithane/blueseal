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

export async function handleAccountUpdated(
  account: StripeAccount,
): Promise<void> {
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
