<script setup lang="ts">
import { computed } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import TrustedTradesPanel from "@/components/TrustedTradesPanel.vue";

useSeo({ title: "Manage", noindex: true });

const auth = useAuthStore();

const firstName = computed(() => (auth.user?.displayName ?? "").trim().split(/\s+/)[0] || "");
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <div class="bs-pill verified mb-3">
      <i class="pi pi-briefcase"></i>
      <span>Project manager</span>
    </div>
    <h1 class="text-2xl font-bold">
      Welcome<template v-if="firstName">, {{ firstName }}</template>.
    </h1>
    <p class="text-[color:var(--bs-muted)] mb-6 max-w-prose">
      This is your cockpit. Recommend trades you trust, set up projects for your clients,
      and track the work. You earn a referral commission when one of your preferred
      contractors does work you set up.
    </p>

    <!-- Section stubs are filled in as the feature lands: Trusted Trades (recommend +
         recruit), Projects (set up + dispatch), Earnings (commission + payouts), and your
         public profile. They render here once each phase ships. -->
    <div class="grid grid-cols-1 gap-3">
      <div>
        <h2 class="font-semibold flex items-center gap-2 mb-1">
          <i class="pi pi-users text-[color:var(--bs-blue)]"></i> Your saved trades
        </h2>
        <p class="text-sm text-[color:var(--bs-muted)] mb-3">
          The tradespeople you recommend. Save them from their profile, then re-hire for a
          client in one tap. Inviting new ones to join is coming next.
        </p>
        <TrustedTradesPanel />
      </div>
      <div class="bs-card p-5">
        <h2 class="font-semibold flex items-center gap-2">
          <i class="pi pi-folder-open text-[color:var(--bs-blue)]"></i> Projects
        </h2>
        <p class="text-sm text-[color:var(--bs-muted)] mt-1">
          Set up jobs for a client and send them to your preferred contractors for quotes.
        </p>
      </div>
      <div class="bs-card p-5">
        <h2 class="font-semibold flex items-center gap-2">
          <i class="pi pi-dollar text-[color:var(--bs-blue)]"></i> Earnings
        </h2>
        <p class="text-sm text-[color:var(--bs-muted)] mt-1">
          Your referral commission accrues as your trades get paid. Set up payouts to get paid.
        </p>
      </div>
    </div>
  </section>
</template>
