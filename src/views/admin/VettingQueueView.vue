<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import {
  listIncompleteApprovals,
  listPendingApplications,
} from "@/firebase/services/tradespeople";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";

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
    <div class="flex items-center justify-between mb-4">
      <div>
        <RouterLink to="/dashboard" class="text-xs text-[color:var(--bs-muted)]">← Back</RouterLink>
        <h1 class="text-2xl font-bold mt-1">Vetting queue</h1>
        <p class="text-[color:var(--bs-muted)] text-sm">Sorted by oldest pending first.</p>
      </div>
      <Button label="Refresh" icon="pi pi-refresh" outlined :loading="loading" @click="refresh" />
    </div>

    <DataTable :value="pending" :loading="loading" data-key="id" :rows="50" striped-rows>
      <template #empty>
        <div class="bs-empty"><i class="pi pi-check-circle text-green-600 mr-2" />Queue clear.</div>
      </template>
      <Column field="id" header="Tradesperson UID">
        <template #body="{ data }">
          <code class="text-xs">{{ data.id.slice(0, 10) }}…</code>
        </template>
      </Column>
      <Column header="Trades">
        <template #body="{ data }">{{ data.trades.join(", ") || "—" }}</template>
      </Column>
      <Column header="Submitted">
        <template #body="{ data }">{{ relativeTime(data.submittedAt) }}</template>
      </Column>
      <Column header="">
        <template #body="{ data }">
          <RouterLink :to="{ name: 'AdminApplication', params: { uid: data.id } }">
            <Button label="Review" icon="pi pi-search" size="small" />
          </RouterLink>
        </template>
      </Column>
    </DataTable>

    <!-- "Approved but not yet live": application got approved before the
         per-item ID/cert checks landed, so the profile isn't visible to
         clients yet. These would otherwise drop off the queue completely. -->
    <div v-if="incomplete.length > 0" class="mt-8">
      <h2 class="text-lg font-semibold">Approved but not yet live</h2>
      <p class="text-sm text-[color:var(--bs-muted)] mb-3">
        Application approved, but ID or at least one certification still needs review before the
        profile goes live.
      </p>
      <DataTable :value="incomplete" data-key="id" :rows="50" striped-rows>
        <Column field="id" header="Tradesperson UID">
          <template #body="{ data }">
            <code class="text-xs">{{ data.id.slice(0, 10) }}…</code>
          </template>
        </Column>
        <Column header="Trades">
          <template #body="{ data }">{{ data.trades.join(", ") || "—" }}</template>
        </Column>
        <Column header="Blocked on">
          <template #body="{ data }">
            <span class="text-xs text-amber-700">
              <template v-if="!data.idVerified && (data.verifiedTrades?.length ?? 0) === 0">
                ID + cert
              </template>
              <template v-else-if="!data.idVerified">ID</template>
              <template v-else>cert</template>
            </span>
          </template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <RouterLink :to="{ name: 'AdminApplication', params: { uid: data.id } }">
              <Button label="Review" icon="pi pi-search" size="small" outlined />
            </RouterLink>
          </template>
        </Column>
      </DataTable>
    </div>
  </section>
</template>
