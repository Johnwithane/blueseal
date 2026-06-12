/**
 * Blue Seal Pro subscription entitlement — the single source of truth for
 * "is this tradesperson a Pro?" on the server.
 *
 * The authoritative state is users/{uid}.subscription (private; carries Stripe
 * ids + trial dates). tradespeople/{uid}.isPro is a PUBLIC denormalized mirror
 * for the client's applicant-list sort — written only by syncSubscriptionMirror
 * (here) and the scheduledProCompExpiry sweep, and locked in firestore.rules.
 *
 * `deriveIsPro` is mirrored client-side at src/utils/subscription.ts — keep the
 * two in sync (cross-package boundary means we can't share the literal).
 *
 * Consumers:
 *  - payments (service-fee waiver) reads deriveIsPro at PaymentIntent creation.
 *  - the AI entitlement seam (functions/src/lib/entitlements.ts) calls assertPro.
 *  - the Stripe Billing webhook handlers call syncSubscriptionMirror.
 */
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin";

export type SubscriptionStatus = "none" | "trialing" | "active" | "past_due" | "canceled";
export type SubscriptionPlan = "monthly" | "annual";

export interface SubscriptionState {
  status: SubscriptionStatus;
  plan: SubscriptionPlan | null;
  trialEndsAt: Timestamp | null;
  currentPeriodEnd: Timestamp | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  everTrialedAt: Timestamp | null;
  proCompUntil: Timestamp | null;
  updatedAt: Timestamp;
}

/**
 * The entitlement decision. `past_due` counts as Pro (Stripe Smart Retries
 * grace — dashboard is configured to cancel after retries exhaust, which then
 * arrives as a subscription.deleted webhook and flips this to false). A
 * `proCompUntil` in the future also grants Pro with no Stripe involved.
 */
export function deriveIsPro(
  sub: SubscriptionState | null | undefined,
  now: Timestamp,
): boolean {
  if (!sub) return false;
  if (sub.status === "trialing" || sub.status === "active" || sub.status === "past_due") {
    return true;
  }
  if (sub.proCompUntil && sub.proCompUntil.toMillis() > now.toMillis()) return true;
  return false;
}

export type SubscriptionReason =
  | "active"
  | "trialing"
  | "past_due_grace"
  | "comp"
  | "none";

export interface ResolvedSubscription {
  isPro: boolean;
  state: SubscriptionState | null;
  reason: SubscriptionReason;
}

export async function getSubscriptionState(uid: string): Promise<ResolvedSubscription> {
  const snap = await db.doc(`users/${uid}`).get();
  const state = (snap.data()?.subscription ?? null) as SubscriptionState | null;
  const now = Timestamp.now();
  const isPro = deriveIsPro(state, now);
  let reason: SubscriptionReason = "none";
  if (state?.status === "active") reason = "active";
  else if (state?.status === "trialing") reason = "trialing";
  else if (state?.status === "past_due") reason = "past_due_grace";
  else if (isPro) reason = "comp";
  return { isPro, state, reason };
}

/**
 * Throw a paywall error unless the caller is Pro. The message leads with the
 * stable `BLUESEAL_PRO_REQUIRED` token so the client can distinguish "needs
 * Pro" from other failed-precondition errors and render the upgrade card
 * (callable HttpsError can't carry a custom code; a token in the message is the
 * portable signal). Admin bypass is the caller's job — admins are checked
 * before this is reached (they hold every entitlement).
 */
export async function assertPro(uid: string): Promise<void> {
  const { isPro } = await getSubscriptionState(uid);
  if (!isPro) {
    throw new HttpsError(
      "failed-precondition",
      "BLUESEAL_PRO_REQUIRED: This is a Blue Seal Pro feature. Start a free trial to use it.",
    );
  }
}

/**
 * Write the authoritative subscription object to users/{uid} AND the derived
 * public isPro flag to tradespeople/{uid}. Single call so the two never drift.
 * The tradespeople write is skipped when no profile exists (client-only
 * accounts never subscribe, but guard anyway so we never mint a phantom
 * tradespeople doc).
 */
export async function syncSubscriptionMirror(
  uid: string,
  sub: SubscriptionState,
): Promise<void> {
  const isPro = deriveIsPro(sub, Timestamp.now());
  await db.doc(`users/${uid}`).set({ subscription: sub }, { merge: true });
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const tradieSnap = await tradieRef.get();
  if (tradieSnap.exists) {
    await tradieRef.set({ isPro }, { merge: true });
  }
}
