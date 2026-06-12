// Blue Seal Pro subscription webhook handlers. The canonical sync is
// customer.subscription.created/updated/deleted → syncSubscriptionMirror, which
// writes users/{uid}.subscription (authoritative) + tradespeople/{uid}.isPro
// (public mirror). checkout.session.completed is belt-and-braces; invoice.
// payment_failed (subscription invoices only) just notifies the tradesperson.

import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../../lib/admin";
import { notify } from "../../lib/notify";
import {
  syncSubscriptionMirror,
  type SubscriptionState,
  type SubscriptionStatus,
  type SubscriptionPlan,
} from "../../lib/subscription";
import { STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_PRO_ANNUAL } from "../stripeClient";
import type { StripeCheckoutSession, StripeInvoice, StripeSubscription } from "./shared";

function customerId(c: string | { id: string } | null | undefined): string | null {
  if (!c) return null;
  return typeof c === "string" ? c : c.id;
}

function tsFromUnix(seconds: number | null | undefined): Timestamp | null {
  return typeof seconds === "number" ? Timestamp.fromMillis(seconds * 1000) : null;
}

// Resolve the Blue Seal uid for a Stripe subscription/customer: metadata first
// (set at checkout), then a users.subscription.stripeCustomerId lookup.
async function resolveUid(
  metadataUid: string | undefined,
  customer: string | null,
): Promise<string | null> {
  if (metadataUid) {
    const snap = await db.doc(`users/${metadataUid}`).get();
    if (snap.exists) return metadataUid;
  }
  if (customer) {
    const q = await db
      .collection("users")
      .where("subscription.stripeCustomerId", "==", customer)
      .limit(1)
      .get();
    if (!q.empty) return q.docs[0].id;
  }
  return null;
}

function mapStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none"; // incomplete, paused, etc.
  }
}

function planFromPriceId(priceId: string | null): SubscriptionPlan | null {
  if (!priceId) return null;
  if (priceId === STRIPE_PRICE_PRO_MONTHLY.value()) return "monthly";
  if (priceId === STRIPE_PRICE_PRO_ANNUAL.value()) return "annual";
  return null;
}

export async function handleSubscriptionChanged(sub: StripeSubscription): Promise<void> {
  const cust = customerId(sub.customer);
  const uid = await resolveUid(sub.metadata?.uid, cust);
  if (!uid) {
    logger.warn("subscription webhook: no user for subscription", {
      subscriptionId: sub.id,
      customer: cust,
    });
    return;
  }

  // Merge onto any existing state so a Stripe change never clobbers proCompUntil
  // / everTrialedAt.
  const snap = await db.doc(`users/${uid}`).get();
  const existing = (snap.data()?.subscription ?? null) as SubscriptionState | null;

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const trialEnd = tsFromUnix(sub.trial_end);

  const next: SubscriptionState = {
    status: mapStatus(sub.status),
    plan: planFromPriceId(priceId) ?? existing?.plan ?? null,
    trialEndsAt: trialEnd ?? existing?.trialEndsAt ?? null,
    currentPeriodEnd: tsFromUnix(sub.current_period_end) ?? existing?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    stripeCustomerId: cust ?? existing?.stripeCustomerId ?? null,
    stripeSubscriptionId: sub.id,
    // Stamp everTrialedAt the first time we ever see a trial — the one-trial guard.
    everTrialedAt: existing?.everTrialedAt ?? (trialEnd ? Timestamp.now() : null),
    proCompUntil: existing?.proCompUntil ?? null,
    updatedAt: Timestamp.now(),
  };

  await syncSubscriptionMirror(uid, next);
  logger.info("subscription webhook: synced", { uid, status: next.status, plan: next.plan });
}

export async function handleCheckoutSessionCompleted(
  session: StripeCheckoutSession,
): Promise<void> {
  if (session.mode !== "subscription") return;
  // The subscription.* events do the real sync; this is just a safety net to
  // ensure the customer id is on file if those somehow race.
  const cust = customerId(session.customer);
  const uid = await resolveUid(session.metadata?.uid, cust);
  if (!uid || !cust) return;
  const snap = await db.doc(`users/${uid}`).get();
  const existing = (snap.data()?.subscription ?? null) as SubscriptionState | null;
  if (existing?.stripeCustomerId) return; // already on file
  await db.doc(`users/${uid}`).set(
    { subscription: { ...(existing ?? {}), stripeCustomerId: cust, updatedAt: Timestamp.now() } },
    { merge: true },
  );
}

export async function handleSubscriptionInvoicePaymentFailed(
  invoice: StripeInvoice,
): Promise<void> {
  // Only subscription invoices — never collide with the client-invoice payment
  // events (those are PaymentIntents, not Stripe Invoices, so they don't reach
  // here anyway, but guard explicitly).
  const isSubscriptionInvoice =
    !!invoice.subscription || (invoice.billing_reason ?? "").startsWith("subscription");
  if (!isSubscriptionInvoice) return;

  const cust = customerId(invoice.customer);
  const uid = await resolveUid(undefined, cust);
  if (!uid) return;

  // Don't flip state here — the subscription.updated → past_due event owns that.
  // Just nudge the tradesperson to fix their card.
  await notify({
    userId: uid,
    type: "invoice_payment_failed",
    title: "Blue Seal Pro payment failed",
    body: "We couldn't charge your card for Blue Seal Pro. Update your payment method to keep your Pro features.",
    link: "/account?tab=pro",
    recipientRole: "tradesperson",
    priority: "high",
  });
}
