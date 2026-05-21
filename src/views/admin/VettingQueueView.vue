<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import { listPendingApplications } from "@/firebase/services/tradespeople";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";

const pending = ref<WithId<TradespersonDoc>[]>([]);
const loading = ref(true);
const { relativeTime } = useFormatters();

async function refresh() {
  loading.value = true;
  pending.value = await listPendingApplications();
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
      <Column field="id" header="Tradie UID">
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
  </section>
</template>
