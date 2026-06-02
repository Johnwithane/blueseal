<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import {
  listIncompleteApprovals,
  listPendingApplications,
} from "@/firebase/services/tradespeople";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { tradeLabel } from "@/data/trades";
import LoadingState from "@/components/LoadingState.vue";

function tradesLabel(t: WithId<TradespersonDoc>): string {
  return t.trades.map((k) => tradeLabel(k)).join(", ") || "—";
}

const pending = ref<WithId<TradespersonDoc>[]>([]);
// Apps where the application is approved but the profile isn't live yet
// (ID or cert still pending). Without this list these get hidden from the
// queue and the tradesperson is stuck.
const incomplete = ref<WithId<TradespersonDoc>[]>([]);
const loading = ref(true);
const { relativeTime } = useFormatters();

async function refresh() {
  loading.value = true;
  [pending.value, incomplete.value] = await Promise.all([
    listPendingApplications(),
    listIncompleteApprovals(),
  ]);
  loading.value = false;
}

onMounted(refresh);
</script>

<template>
  <section class="bs-container py-6">
    <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <RouterLink to="/dashboard" class="text-xs text-[color:var(--bs-muted)]">← Back</RouterLink>
        <p class="text-[color:var(--bs-muted)] text-sm mt-1">Sorted by oldest pending first.</p>
      </div>
      <Button label="Refresh" icon="pi pi-refresh" outlined :loading="loading" class="self-start sm:self-auto" @click="refresh" />
    </div>

    <LoadingState v-if="loading" />
    <div v-else-if="pending.length === 0" class="bs-empty">
      <i class="pi pi-check-circle text-green-600 mr-2" />Queue clear.
    </div>
    <ul v-else class="space-y-2">
      <li
        v-for="t in pending"
        :key="t.id"
        class="bs-card p-3 flex flex-wrap items-center justify-between gap-3"
      >
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ tradesLabel(t) }}</div>
          <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
            Submitted {{ relativeTime(t.submittedAt) }} ·
            <code>{{ t.id.slice(0, 10) }}…</code>
          </div>
        </div>
        <RouterLink :to="{ name: 'AdminApplication', params: { uid: t.id } }">
          <Button label="Review" icon="pi pi-search" size="small" />
        </RouterLink>
      </li>
    </ul>

    <!-- "Approved but not yet live": application got approved before the
         per-item ID/cert checks landed, so the profile isn't visible to
         clients yet. These would otherwise drop off the queue completely. -->
    <div v-if="incomplete.length > 0" class="mt-8">
      <h2 class="text-lg font-semibold">Approved but not yet live</h2>
      <p class="text-sm text-[color:var(--bs-muted)] mb-3">
        Application approved, but ID or at least one certification still needs review before the
        profile goes live.
      </p>
      <ul class="space-y-2">
        <li
          v-for="t in incomplete"
          :key="t.id"
          class="bs-card p-3 flex flex-wrap items-center justify-between gap-3"
        >
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ tradesLabel(t) }}</div>
            <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
              Blocked on
              <span class="text-amber-700 font-medium">
                <template v-if="!t.idVerified && (t.verifiedTrades?.length ?? 0) === 0">
                  ID + cert
                </template>
                <template v-else-if="!t.idVerified">ID</template>
                <template v-else>cert</template>
              </span>
              · <code>{{ t.id.slice(0, 10) }}…</code>
            </div>
          </div>
          <RouterLink :to="{ name: 'AdminApplication', params: { uid: t.id } }">
            <Button label="Review" icon="pi pi-search" size="small" outlined />
          </RouterLink>
        </li>
      </ul>
    </div>
  </section>
</template>
