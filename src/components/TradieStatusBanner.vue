<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Button from "primevue/button";
import { useAuthStore } from "@/stores/auth";
import { subscribeTradesperson } from "@/firebase/services/tradespeople";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";

// Global status banner shown to a signed-in user whose ACTIVE view is
// "tradesperson". Renders for every status except `approved` so the user
// always knows whether onboarding is incomplete, awaiting review, blocked
// on more info, or rejected. Hidden on /onboarding (they're already there).
const auth = useAuthStore();
const route = useRoute();

const tradie = ref<WithId<TradespersonDoc> | null>(null);
let unsub: (() => void) | null = null;

function stop() {
  if (unsub) {
    unsub();
    unsub = null;
  }
}

function start(uid: string) {
  stop();
  unsub = subscribeTradesperson(uid, (t) => (tradie.value = t));
}

// Subscribe whenever the signed-in user is a tradesperson in active view.
// Cancel + clear the doc when they sign out or switch to another view so
// stale data can't render after a switch.
watch(
  () => [auth.fbUser?.uid ?? null, auth.activeRole] as const,
  ([uid, role]) => {
    if (uid && role === "tradesperson") {
      start(uid);
    } else {
      stop();
      tradie.value = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(stop);

interface BannerContent {
  severity: "info" | "warn" | "error";
  icon: string;
  label: string;
  message: string;
  // Optional CTA — link target + button label.
  cta?: { to: string; label: string };
}

const content = computed<BannerContent | null>(() => {
  if (!auth.isAuthenticated || auth.activeRole !== "tradesperson") return null;
  if (route.path === "/onboarding") return null;
  // The payouts view is itself the place to act on payouts state — banner
  // would just nag the user about what they're already looking at.
  if (route.path.startsWith("/payouts")) return null;

  // No doc yet (just added the role, or still loading) — show the onboarding
  // nudge. Same copy as `draft` so the user doesn't see a flicker between
  // states while the subscription warms up.
  const status = tradie.value?.vettingStatus ?? "draft";

  switch (status) {
    case "draft":
      return {
        severity: "warn",
        icon: "pi-exclamation-circle",
        label: "Onboarding incomplete",
        message:
          "Finish your tradesperson onboarding to submit your application for review.",
        cta: { to: "/onboarding", label: "Finish onboarding" },
      };
    case "pending":
      return {
        severity: "info",
        icon: "pi-clock",
        label: "Application under review",
        message:
          "Thanks for applying. Our team typically reviews submissions within 48 hours — we'll notify you once you're approved.",
      };
    case "info_requested":
      return {
        severity: "warn",
        icon: "pi-exclamation-circle",
        label: "More info needed",
        message:
          tradie.value?.vettingNotes?.trim() ||
          "Our reviewer asked for a few changes before approving your application.",
        cta: { to: "/onboarding", label: "Update application" },
      };
    case "rejected":
      return {
        severity: "error",
        icon: "pi-times-circle",
        label: "Application not approved",
        message:
          tradie.value?.vettingNotes?.trim() ||
          "Your application wasn't approved. Reply to the email we sent for next steps.",
      };
    case "approved": {
      // Once vetting is approved, the banner moves on to nudging payouts
      // setup. Treat missing `payouts` as `not_started` so pre-migration
      // docs see the kickoff CTA. `enabled` = no banner.
      const payouts = tradie.value?.payouts;
      const onboarding = payouts?.onboardingStatus ?? "not_started";
      if (onboarding === "enabled") return null;
      if (onboarding === "restricted") {
        return {
          severity: "error",
          icon: "pi-exclamation-triangle",
          label: "Stripe paused your payouts",
          message:
            "Stripe needs more info before payouts can resume. Open Payouts to see what's needed.",
          cta: { to: "/payouts", label: "Fix on Stripe" },
        };
      }
      if (onboarding === "in_progress") {
        return {
          severity: "warn",
          icon: "pi-clock",
          label: "Finish payout setup",
          message:
            "You started Stripe onboarding but haven't finished. Pick up where you left off so clients can pay you through Blue Seal.",
          cta: { to: "/payouts", label: "Continue setup" },
        };
      }
      return {
        severity: "info",
        icon: "pi-credit-card",
        label: "Connect your bank account",
        message: "Add your details so clients can pay you — about 5 minutes.",
        cta: { to: "/payouts", label: "Set up" },
      };
    }
    default:
      return null;
  }
});
</script>

<template>
  <div
    v-if="content"
    :class="[
      'bs-tradie-status-banner',
      `bs-tradie-status-banner--${content.severity}`,
    ]"
    role="status"
  >
    <div class="bs-container flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-3">
      <div class="flex flex-1 items-start gap-3 min-w-0">
        <i :class="['pi', content.icon, 'bs-tradie-status-banner__icon']" aria-hidden="true"></i>
        <div class="min-w-0">
          <div class="text-sm font-semibold leading-tight">{{ content.label }}</div>
          <div class="mt-0.5 text-sm leading-snug text-[color:var(--bs-text)]/85">
            {{ content.message }}
          </div>
        </div>
      </div>
      <RouterLink v-if="content.cta" :to="content.cta.to" class="shrink-0 self-start">
        <Button :label="content.cta.label" size="small" icon="pi pi-arrow-right" icon-pos="right" />
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.bs-tradie-status-banner {
  border-bottom: 1px solid var(--bs-border);
}
.bs-tradie-status-banner--info {
  background: #eaf5fc;
}
.bs-tradie-status-banner--warn {
  background: #fff5e6;
}
.bs-tradie-status-banner--error {
  background: #fdecec;
}
.bs-tradie-status-banner__icon {
  font-size: 1.15rem;
  margin-top: 0.1rem;
}
.bs-tradie-status-banner--info .bs-tradie-status-banner__icon {
  color: var(--bs-blue-dark);
}
.bs-tradie-status-banner--warn .bs-tradie-status-banner__icon {
  color: #b45309;
}
.bs-tradie-status-banner--error .bs-tradie-status-banner__icon {
  color: #b91c1c;
}
</style>
