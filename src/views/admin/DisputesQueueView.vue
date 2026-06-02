<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import {
  listClosedDisputes,
  listOpenDisputes,
} from "@/firebase/services/disputes";
import { useFormatters } from "@/composables/useFormatters";
import type { DisputeDoc, WithId } from "@/firebase/interfaces";
import LoadingState from "@/components/LoadingState.vue";

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

function reasonLabel(reason: string | null): string {
  return (reason ?? "—").replace(/_/g, " ");
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

function outcomeSeverity(outcome: string | null): "success" | "danger" | "secondary" {
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

    <LoadingState v-if="loading" />
    <div v-else-if="open.length === 0" class="bs-empty">
      <i class="pi pi-check-circle text-green-600 mr-2" />No open disputes.
    </div>
    <ul v-else class="space-y-2">
      <li v-for="d in open" :key="d.id" class="bs-card p-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold tabular-nums">
                {{ fmtMoney(d.amount, d.currency) }}
              </span>
              <span class="text-xs capitalize text-[color:var(--bs-muted)]">
                {{ reasonLabel(d.reason) }}
              </span>
              <Tag
                v-if="d.evidenceDueBy"
                :severity="urgencySeverity(daysUntilDue(d))"
                :value="`${daysUntilDue(d)}d left`"
              />
            </div>
            <div class="text-xs text-[color:var(--bs-muted)] mt-1">
              <span class="capitalize">{{ reasonLabel(d.status) }}</span> ·
              created {{ relativeTime(d.createdAt) }}
              <template v-if="d.evidenceDueBy">
                · evidence due {{ relativeTime(d.evidenceDueBy) }}
              </template>
            </div>
          </div>
          <RouterLink :to="{ name: 'AdminDisputeDetail', params: { id: d.id } }">
            <Button label="Open" icon="pi pi-search" size="small" />
          </RouterLink>
        </div>
      </li>
    </ul>

    <div v-if="closed.length > 0" class="mt-8">
      <h2 class="text-lg font-semibold">Recently closed</h2>
      <p class="text-sm text-[color:var(--bs-muted)] mb-3">
        Last 50 closed disputes, newest first.
      </p>
      <ul class="space-y-2">
        <li v-for="d in closed" :key="d.id" class="bs-card p-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-semibold tabular-nums">
                  {{ fmtMoney(d.amount, d.currency) }}
                </span>
                <span class="text-xs capitalize text-[color:var(--bs-muted)]">
                  {{ reasonLabel(d.reason) }}
                </span>
                <Tag :severity="outcomeSeverity(d.outcome)" :value="d.outcome" />
              </div>
              <div class="text-xs text-[color:var(--bs-muted)] mt-1">
                closed {{ relativeTime(d.updatedAt) }}
              </div>
            </div>
            <RouterLink :to="{ name: 'AdminDisputeDetail', params: { id: d.id } }">
              <Button label="Open" icon="pi pi-search" size="small" outlined />
            </RouterLink>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
