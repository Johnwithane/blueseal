<script setup lang="ts">
import { watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { useToast } from "@/composables/useToast";
import PayoutsPanel from "@/components/PayoutsPanel.vue";

// Three routes (named `Payouts`, `PayoutsReturn`, `PayoutsRefresh`) all
// mount this view because Stripe's hosted onboarding bounces back via fixed
// return / refresh URLs and the user needs to land somewhere — but the
// shared in-app payouts UI lives inside AccountView's "Payouts" tab now, so
// this view is just the wrapper that:
//   - shows a one-time toast for the Stripe return / refresh hints
//   - rewrites the URL back to /payouts so reloads don't re-fire the toast
//   - renders the shared <PayoutsPanel /> for direct visits to /payouts
//     (vouch invite emails, deep-links, etc).
const route = useRoute();
const router = useRouter();
const toast = useToast();

watch(
  () => route.name,
  (name) => {
    if (name === "PayoutsReturn") {
      toast.success(
        "Stripe says your details are submitted. Give it a few seconds to confirm.",
      );
      void router.replace({ name: "Payouts" });
    } else if (name === "PayoutsRefresh") {
      toast.info(
        "Your onboarding link expired. Click 'Continue Stripe setup' to generate a new one.",
      );
      void router.replace({ name: "Payouts" });
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="bs-container py-6">
    <div class="mb-4">
      <RouterLink
        :to="{ name: 'Account', query: { tab: 'payouts' } }"
        class="text-sm text-[color:var(--bs-muted)] hover:underline"
      >
        <i class="pi pi-arrow-left text-xs"></i>
        Back to Account
      </RouterLink>
    </div>
    <PayoutsPanel />
  </section>
</template>
