<script setup lang="ts">
import { useSeo } from "@/composables/useSeo";
import PmEarningsPanel from "@/components/manage/PmEarningsPanel.vue";

useSeo({ title: "Earnings", noindex: true });
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <h1 class="text-2xl font-bold mb-1">Earnings</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mb-5">
      You earn a referral commission when one of your preferred trades does work you set up.
      Set up payouts to get paid each month.
    </p>
    <PmEarningsPanel />
  </section>
</template>
