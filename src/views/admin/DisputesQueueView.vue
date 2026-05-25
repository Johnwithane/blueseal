<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Tag from "primevue/tag";
import {
  listClosedDisputes,
  listOpenDisputes,
} from "@/firebase/services/disputes";
import { useFormatters } from "@/composables/useFormatters";
import type { DisputeDoc, WithId } from "@/firebase/interfaces";

const open = ref<WithId<DisputeDoc>[]>([]);
const closed = ref<WithId<DisputeDoc>[]>([]);
const loading = ref(true);
const { relativeTime } = useFormatters();

async function refresh() {
  loading.value = true;
  [open.value, closed.value] = await Promise.all([
    listOpenDisputes(),
    listClosedDisputes(),
  ]);
  loading.value = false;
}

onMounted(refresh);

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );
}

function reasonLabel(reason: string): string {
  return reason.replace(/_/g, " ");
}

// Days-until-evidence-due, used to colour-code urgency. Stripe gives us
// roughly 7-21 days depending on dispute type; under 3 days = urgent.
function daysUntilDue(d: WithId<DisputeDoc>): number | null {
  if (!d.evidenceDueBy) return null;
  const ms = d.evidenceDueBy.toMillis() - Date.now();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function urgencySeverity(
  days: number | null,
): "danger" | "warn" | "info" | "secondary" {
  if (days === null) return "secondary";
  if (days <= 1) return "danger";
  if (days <= 3) return "warn";
  return "info";
}

function outcomeSeverity(outcome: string): "success" | "danger" | "secondary" {
  if (outcome === "won") return "success";
  if (outcome === "lost") return "danger";
  return "secondary";
}

const openCount = computed(() => open.value.length);
</script>

<template>
  <section class="bs-container py-6">
    <div class="flex items-center justify-between mb-4">
      <div>
        <RouterLink to="/dashboard" class="text-xs text-[color:var(--bs-muted)]"
          >← Back</RouterLink
        >
        <p class="text-[color:var(--bs-muted)] text-sm mt-1">
          {{ openCount }} open dispute{{ openCount === 1 ? "" : "s" }}. Evidence
          is submitted via the Stripe Dashboard — this queue is for awareness +
          coordination.
        </p>
      </div>
      <Button
        label="Refresh"
        icon="pi pi-refresh"
        outlined
        :loading="loading"
        @click="refresh"
      />
    </div>

    <DataTable
      :value="open"
      :loading="loading"
      data-key="id"
      :rows="50"
      striped-rows
    >
      <template #empty>
        <div class="bs-empty">
          <i class="pi pi-check-circle text-green-600 mr-2" />No open disputes.
        </div>
      </template>
      <Column header="Amount">
        <template #body="{ data }">
          <span class="font-semibold tabular-nums">
            {{ fmtMoney(data.amount, data.currency) }}
          </span>
        </template>
      </Column>
      <Column header="Reason">
        <template #body="{ data }">
          <span class="capitalize">{{ reasonLabel(data.reason) }}</span>
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }">
          <code class="text-xs">{{ data.status }}</code>
        </template>
      </Column>
      <Column header="Evidence due">
        <template #body="{ data }">
          <template v-if="data.evidenceDueBy">
            <Tag
              :severity="urgencySeverity(daysUntilDue(data))"
              :value="`${daysUntilDue(data)}d`"
            />
            <span class="ml-2 text-xs text-[color:var(--bs-muted)]">
              {{ relativeTime(data.evidenceDueBy) }}
            </span>
          </template>
          <span v-else class="text-xs text-[color:var(--bs-muted)]">—</span>
        </template>
      </Column>
      <Column header="Created">
        <template #body="{ data }">
          {{ relativeTime(data.createdAt) }}
        </template>
      </Column>
      <Column header="">
        <template #body="{ data }">
          <RouterLink :to="{ name: 'AdminDisputeDetail', params: { id: data.id } }">
            <Button label="Open" icon="pi pi-search" size="small" />
          </RouterLink>
        </template>
      </Column>
    </DataTable>

    <div v-if="closed.length > 0" class="mt-8">
      <h2 class="text-lg font-semibold">Recently closed</h2>
      <p class="text-sm text-[color:var(--bs-muted)] mb-3">
        Last 50 closed disputes, newest first.
      </p>
      <DataTable :value="closed" data-key="id" :rows="50" striped-rows>
        <Column header="Amount">
          <template #body="{ data }">
            <span class="font-semibold tabular-nums">
              {{ fmtMoney(data.amount, data.currency) }}
            </span>
          </template>
        </Column>
        <Column header="Reason">
          <template #body="{ data }">
            <span class="capitalize">{{ reasonLabel(data.reason) }}</span>
          </template>
        </Column>
        <Column header="Outcome">
          <template #body="{ data }">
            <Tag
              :severity="outcomeSeverity(data.outcome)"
              :value="data.outcome"
            />
          </template>
        </Column>
        <Column header="Closed">
          <template #body="{ data }">
            {{ relativeTime(data.updatedAt) }}
          </template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <RouterLink
              :to="{ name: 'AdminDisputeDetail', params: { id: data.id } }"
            >
              <Button label="Open" icon="pi pi-search" size="small" outlined />
            </RouterLink>
          </template>
        </Column>
      </DataTable>
    </div>
  </section>
</template>
