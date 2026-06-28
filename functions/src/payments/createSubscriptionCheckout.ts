// Start a Blue Seal Pro subscription: returns a Stripe Checkout Session URL
// (subscription mode). The client redirects the browser to it; on completion
// Stripe fires checkout.session.completed + customer.subscription.created,
// which the webhook syncs into users/{uid}.subscription.
//
// Trial: 30 days, card required (payment_method_collection: "always"). One trial
// per tradesperson — guarded server-side via subscription.everTrialedAt so a
// deleted-and-recreated Stripe customer can't reset it.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAnyRole } from "../lib/auth";
import type { SubscriptionState } from "../lib/subscription";
import {
  STRIPE_SECRET_KEY,
  STRIPE_PRICE_PRO_MONTHLY,
  STRIPE_PRICE_PRO_ANNUAL,
  getStripe,
} from "./stripeClient";

const Input = z.object({ plan: z.enum(["monthly", "annual"]) });

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://blueseal.app").replace(/\/$/, "");
}

export const createSubscriptionCheckout = onCall(
  {
    ...CALLABLE_OPTS,
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req) => {
    // Blue Seal Pro is one subscription shared by both pro roles: tradespeople and
    // project managers subscribe through the same flow / trial.
    const uid = requireAnyRole(req, ["tradesperson", "projectManager"]);
    const parsed = Input.safeParse(req.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
    const { plan } = parsed.data;

    const priceId =
      plan === "monthly"
        ? STRIPE_PRICE_PRO_MONTHLY.value()
        : STRIPE_PRICE_PRO_ANNUAL.value();
    if (!priceId) {
      throw new HttpsError("internal", "Blue Seal Pro pricing isn't configured.");
    }

    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");
    const userData = userSnap.data() ?? {};
    const existing = (userData.subscription ?? null) as SubscriptionState | null;

    // Already Pro via Stripe? Don't let them double-subscribe. (A founding comp
    // doesn't block subscribing — it just overlaps until it lapses.)
    if (
      existing &&
      (existing.status === "active" ||
        existing.status === "trialing" ||
        existing.status === "past_due")
    ) {
      throw new HttpsError("failed-precondition", "You're already on Blue Seal Pro.");
    }

    const stripe = getStripe();

    // Reuse or create the customer; persist the id immediately.
    let customerId = existing?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: typeof userData.email === "string" ? userData.email : undefined,
        name: typeof userData.displayName === "string" ? userData.displayName : undefined,
        metadata: { uid },
      });
      customerId = customer.id;
      const seeded: SubscriptionState = {
        status: existing?.status ?? "none",
        plan: existing?.plan ?? null,
        trialEndsAt: existing?.trialEndsAt ?? null,
        currentPeriodEnd: existing?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: existing?.cancelAtPeriodEnd ?? false,
        stripeCustomerId: customerId,
        stripeSubscriptionId: existing?.stripeSubscriptionId ?? null,
        everTrialedAt: existing?.everTrialedAt ?? null,
        proCompUntil: existing?.proCompUntil ?? null,
        updatedAt: Timestamp.now(),
      };
      await userRef.set({ subscription: seeded }, { merge: true });
    }

    // One trial per tradesperson, independent of Stripe's per-customer memory.
    const trialEligible = !existing?.everTrialedAt && !existing?.stripeSubscriptionId;

    const base = appBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { uid },
        ...(trialEligible ? { trial_period_days: 30 } : {}),
      },
      payment_method_collection: "always",
      allow_promotion_codes: true,
      success_url: `${base}/account?tab=pro&checkout=success`,
      cancel_url: `${base}/pricing?checkout=cancelled`,
    });

    logger.info("createSubscriptionCheckout", { uid, plan, trialEligible });
    return { url: session.url };
  },
);
