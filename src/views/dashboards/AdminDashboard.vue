<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import { listPendingApplications } from "@/firebase/services/tradespeople";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables";

const pending = ref<WithId<TradespersonDoc>[]>([]);
const loading = ref(true);
const { relativeTime } = useFormatters();

onMounted(async () => {
  loading.value = true;
  pending.value = await listPendingApplications();
  loading.value = false;
});
</script>

<template>
  <section class="bs-container py-8">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold">Admin console</h1>
        <p class="text-[color:var(--bs-muted)]">
          {{ pending.length }} application{{ pending.length === 1 ? "" : "s" }} awaiting review.
        </p>
      </div>
      <RouterLink to="/admin/vetting">
        <Button label="Open vetting queue" icon="pi pi-arrow-right" />
      </RouterLink>
    </div>

    <div class="grid sm:grid-cols-3 gap-4 mb-6">
      <div class="bs-card p-5">
        <div class="text-sm text-[color:var(--bs-muted)]">Pending vetting</div>
        <div class="text-3xl font-bold mt-1">{{ pending.length }}</div>
      </div>
      <div class="bs-card p-5">
        <div class="text-sm text-[color:var(--bs-muted)]">Oldest pending</div>
        <div class="text-3xl font-bold mt-1">
          {{ pending.length ? relativeTime(pending[0].submittedAt) : "—" }}
        </div>
      </div>
      <div class="bs-card p-5">
        <div class="text-sm text-[color:var(--bs-muted)]">Region</div>
        <div class="text-3xl font-bold mt-1">CA</div>
      </div>
    </div>

    <div v-if="loading" class="bs-empty">Loading…</div>
    <div v-else-if="pending.length === 0" class="bs-empty">
      <i class="pi pi-check-circle text-3xl mb-2 block text-green-600"></i>
      <p>Queue clear. Nice work.</p>
    </div>
    <div v-else class="space-y-3">
      <RouterLink
        v-for="t in pending"
        :key="t.id"
        :to="{ name: 'AdminApplication', params: { uid: t.id } }"
        class="bs-card p-4 flex items-center justify-between no-underline text-inherit hover:shadow-md"
      >
        <div>
          <div class="font-semibold">{{ t.id }}</div>
          <div class="text-xs text-[color:var(--bs-muted)]">
            Trades: {{ t.trades.join(", ") || "—" }} • Submitted {{ relativeTime(t.submittedAt) }}
          </div>
        </div>
        <i class="pi pi-chevron-right text-[color:var(--bs-muted)]"></i>
      </RouterLink>
    </div>
  </section>
</template>
