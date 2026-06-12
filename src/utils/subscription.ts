// Client mirror of functions/src/lib/subscription.ts → deriveIsPro. Keep the
// two in sync. The authoritative entitlement is always the server's (rules +
// callables), but the UI needs to decide what to show without a round-trip.

import type { SubscriptionPlan, SubscriptionState } from "@/firebase/interfaces";

export function deriveIsPro(sub: SubscriptionState | null | undefined): boolean {
  if (!sub) return false;
  if (sub.status === "trialing" || sub.status === "active" || sub.status === "past_due") {
    return true;
  }
  if (sub.proCompUntil && sub.proCompUntil.toMillis() > Date.now()) return true;
  return false;
}

export function isTrialing(sub: SubscriptionState | null | undefined): boolean {
  return sub?.status === "trialing";
}

export function isComped(sub: SubscriptionState | null | undefined): boolean {
  return !!sub?.proCompUntil && sub.proCompUntil.toMillis() > Date.now();
}

/** Whole days left on the trial (or comp), or null when neither applies. */
export function proDaysLeft(sub: SubscriptionState | null | undefined): number | null {
  const end =
    sub?.status === "trialing"
      ? (sub.trialEndsAt?.toMillis() ?? null)
      : isComped(sub)
        ? (sub?.proCompUntil?.toMillis() ?? null)
        : null;
  if (end == null) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24)));
}

export function planLabel(plan: SubscriptionPlan | null | undefined): string {
  if (plan === "monthly") return "$29 CAD / month";
  if (plan === "annual") return "$290 CAD / year";
  return "";
}

export function statusHeadline(sub: SubscriptionState | null | undefined): string {
  if (!sub) return "Not subscribed";
  if (isComped(sub) && sub.status !== "active" && sub.status !== "trialing") {
    return "Founding member — Pro on us";
  }
  switch (sub.status) {
    case "trialing":
      return "Free trial active";
    case "active":
      return sub.cancelAtPeriodEnd ? "Pro — ends at period end" : "Blue Seal Pro active";
    case "past_due":
      return "Payment failed — update your card";
    case "canceled":
      return "Subscription ended";
    default:
      return "Not subscribed";
  }
}
