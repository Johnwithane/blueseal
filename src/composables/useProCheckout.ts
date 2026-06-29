import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useSubscriptionStore } from "@/stores/subscription";
import { createSubscriptionCheckout } from "@/firebase/services/subscriptionService";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { SubscriptionPlan } from "@/firebase/interfaces";

/**
 * The shared "Start Blue Seal Pro" action, role-aware so the same button does
 * the right thing from the pricing page, the paywall popup, or anywhere else:
 *  - already Pro → Manage your subscription (account)
 *  - signed-out → sign up as a tradesperson
 *  - client-only account (no pro role) → account page to add the tradesperson role
 *  - eligible tradesperson OR project manager → Stripe Checkout (30-day trial)
 *
 * Blue Seal Pro is one subscription shared by both pro roles (tradespeople and
 * project managers), so either can subscribe through this same path.
 *
 * `busy` drives the button spinner during the checkout round-trip.
 */
export function useProCheckout() {
  const auth = useAuthStore();
  const router = useRouter();
  const subscription = useSubscriptionStore();
  const toast = useToast();
  const busy = ref(false);

  async function startPro(plan: SubscriptionPlan = "annual") {
    if (subscription.isPro) {
      void router.push({ path: "/account", query: { tab: "pro" } });
      return;
    }
    if (!auth.isAuthenticated) {
      void router.push({ path: "/sign-up", query: { as: "tradesperson" } });
      return;
    }
    if (!auth.hasTradieRole && !auth.hasProjectManagerRole) {
      // Client-only account — they need a pro role (tradesperson or project
      // manager) to subscribe.
      void router.push({ path: "/account", query: { tab: "account" } });
      toast.info("Add a pro role to subscribe", "Blue Seal Pro is for tradespeople and project managers.");
      return;
    }
    busy.value = true;
    try {
      const { url } = await createSubscriptionCheckout(plan);
      if (url) window.location.assign(url);
      else throw new Error("Couldn't start checkout.");
    } catch (err) {
      toast.error(humanizeError(err));
      busy.value = false;
    }
  }

  return { busy, startPro };
}
