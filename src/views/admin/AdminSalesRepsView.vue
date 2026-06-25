<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Message from "primevue/message";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import {
  listSalesReps,
  listPayoutBatchesNeedingAttention,
  retryPayoutBatch,
  setRepActive,
  type RepSummary,
} from "@/firebase/services/adminSalesReps";
import type { CommissionPayoutDoc, WithId } from "@/firebase/interfaces";

// Admin sales-reps console: the rep roster (code, regions, earnings, payout
// status, activate/deactivate) + payout batches needing attention (retry a
// pending transfer). Territory rep assignment lives in /admin/regions.
const toast = useToast();
const { date } = useFormatters();

const reps = ref<RepSummary[]>([]);
const attention = ref<WithId<CommissionPayoutDoc>[]>([]);
const loading = ref(true);
const busy = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    const [r, a] = await Promise.all([
      listSalesReps(),
      listPayoutBatchesNeedingAttention(),
    ]);
    reps.value = r;
    attention.value = a;
  } catch (e) {
    toast.error("Couldn't load", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

const payoutsStatusLabel: Record<string, string> = {
  enabled: "Payouts live",
  in_progress: "Onboarding",
  restricted: "Restricted",
  not_started: "No bank yet",
};

async function toggleActive(rep: RepSummary) {
  busy.value = rep.uid;
  try {
    await setRepActive(rep.uid, !rep.active);
    rep.active = !rep.active;
    toast.success("Saved", `${rep.displayName || "Rep"} ${rep.active ? "activated" : "deactivated"}.`);
  } catch (e) {
    toast.error("Couldn't update", humanizeError(e));
  } finally {
    busy.value = null;
  }
}

async function retry(batch: WithId<CommissionPayoutDoc>) {
  busy.value = batch.id;
  try {
    await retryPayoutBatch(batch.id);
    toast.success("Transfer sent", "The pending payout was reconciled.");
    await load();
  } catch (e) {
    toast.error("Retry failed", humanizeError(e));
  } finally {
    busy.value = null;
  }
}

const pendingBatches = computed(() => attention.value.filter((b) => b.status === "pending"));
const failedBatches = computed(() => attention.value.filter((b) => b.status === "failed"));
</script>

<template>
  <section class="bs-container py-6 max-w-3xl">
    <header class="mb-5 flex items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold">Sales reps</h1>
        <p class="text-sm text-[color:var(--bs-muted)] mt-1">
          The rep roster, their earnings, and payout health. Assign reps to territories in
          <RouterLink to="/admin/regions" class="text-[color:var(--bs-blue)] hover:underline">Regions</RouterLink>.
        </p>
      </div>
      <Button icon="pi pi-refresh" text :loading="loading" aria-label="Reload" @click="load" />
    </header>

    <div v-if="loading" class="bs-card p-5 text-sm text-[color:var(--bs-muted)]">
      <i class="pi pi-spin pi-spinner mr-2"></i>Loading…
    </div>

    <template v-else>
      <!-- Payout batches needing attention -->
      <div v-if="attention.length" class="mb-5">
        <h2 class="text-sm font-semibold mb-2">Payouts needing attention</h2>

        <div v-for="b in pendingBatches" :key="b.id" class="bs-card p-4 mb-2">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="font-medium tabular-nums">{{ fmtMoney(b.amountCents) }}</div>
              <div class="text-xs text-[color:var(--bs-muted)]">
                Pending transfer · {{ b.commissionIds.length }} entries
                <span v-if="b.periodEnd?.toDate"> · {{ date(b.periodEnd.toDate()) }}</span>
              </div>
            </div>
            <Button
              label="Retry transfer"
              size="small"
              icon="pi pi-replay"
              :loading="busy === b.id"
              @click="retry(b)"
            />
          </div>
        </div>

        <Message v-if="failedBatches.length" severity="warn" :closable="false" class="mt-2">
          {{ failedBatches.length }} failed
          {{ failedBatches.length === 1 ? "batch" : "batches" }} — the commissions rolled back to
          accrued and will be retried in the next monthly run.
        </Message>
      </div>

      <!-- Rep roster -->
      <div v-if="!reps.length" class="bs-card p-5 text-sm text-[color:var(--bs-muted)]">
        No sales reps yet. Grant a user the <strong>sales</strong> role in
        <RouterLink to="/admin/users" class="text-[color:var(--bs-blue)] hover:underline">Users</RouterLink>.
      </div>

      <div v-for="rep in reps" :key="rep.uid" class="bs-card p-4 mb-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium">{{ rep.displayName || rep.email || rep.uid }}</span>
              <span
                v-if="!rep.active"
                class="text-[11px] font-medium rounded-full px-2 py-0.5 bg-[color:var(--bs-danger-tint)] text-[color:var(--bs-danger-text)]"
              >Deactivated</span>
              <span
                v-if="!rep.liabilitySigned"
                class="text-[11px] font-medium rounded-full px-2 py-0.5 bg-[color:var(--bs-warning-tint)] text-[color:var(--bs-warning-text)]"
              >Unsigned</span>
            </div>
            <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
              <span v-if="rep.referralCode" class="font-mono">{{ rep.referralCode }}</span>
              <span v-else>No code yet</span>
              · {{ payoutsStatusLabel[rep.payoutsStatus] ?? rep.payoutsStatus }}
            </div>
            <div v-if="rep.regionNames.length" class="mt-1.5 flex flex-wrap gap-1">
              <span
                v-for="name in rep.regionNames"
                :key="name"
                class="text-[11px] rounded-full px-2 py-0.5"
                style="background-color: var(--bs-surface-alt)"
              >{{ name }}</span>
            </div>
          </div>
          <Button
            :label="rep.active ? 'Deactivate' : 'Activate'"
            :severity="rep.active ? 'danger' : 'secondary'"
            text
            size="small"
            :loading="busy === rep.uid"
            @click="toggleActive(rep)"
          />
        </div>

        <div class="mt-3 flex gap-6 text-sm border-t border-[color:var(--bs-border)] pt-3">
          <div>
            <span class="text-[color:var(--bs-muted)] text-xs block">Unpaid</span>
            <span class="font-semibold tabular-nums">{{ fmtMoney(rep.unpaidCents) }}</span>
          </div>
          <div>
            <span class="text-[color:var(--bs-muted)] text-xs block">Paid to date</span>
            <span class="font-semibold tabular-nums">{{ fmtMoney(rep.paidCents) }}</span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
