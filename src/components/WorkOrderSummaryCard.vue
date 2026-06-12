<script setup lang="ts">
// At-a-glance "charges so far" for the Work order tab. On a fixed-price job it
// leads with the agreed quote price and adds approved change orders on top
// ("fixed price + work order"); on an hourly job it sums the running actuals
// (time + materials + change orders). Both parties see it; only the
// tradesperson gets the Create invoice button (opens the wrap-up sheet, same as
// the Invoice tab). Charges use rollUpJobCharges so the figure agrees with the
// invoice it previews.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import { subscribeJobTimeEntries } from "@/firebase/services/timeEntries";
import { subscribeJobExpenses } from "@/firebase/services/expenses";
import { getQuoteByJobId } from "@/firebase/services/quotes";
import { rollUpJobCharges } from "@/utils/jobCharges";
import { useFormatters } from "@/composables/useFormatters";
import type {
  ExpenseDoc,
  JobDoc,
  JobExtraDoc,
  TimeEntryDoc,
  WithId,
} from "@/firebase/interfaces";

const props = defineProps<{
  job: WithId<JobDoc>;
  isTradie: boolean;
  isClient: boolean;
  billingType: "hourly" | "fixed";
  extras: WithId<JobExtraDoc>[];
}>();

const emit = defineEmits<{
  /** Tradesperson wants the wrap-up sheet (Create / Update invoice). */
  "create-invoice": [];
}>();

const { money } = useFormatters();

const isFixed = computed(() => props.billingType === "fixed");

// ----- live data: time (both parties) + expenses (tradesperson only) -----
// Receipts are tradesperson-only by rule, so the client can't subscribe to
// them — their tally covers time + change orders.
const timeEntries = ref<WithId<TimeEntryDoc>[]>([]);
const expenses = ref<WithId<ExpenseDoc>[]>([]);
const nowMs = ref(Date.now());
let timeUnsub: (() => void) | null = null;
let expensesUnsub: (() => void) | null = null;
let ticker: number | null = null;

function detach() {
  timeUnsub?.();
  expensesUnsub?.();
  timeUnsub = null;
  expensesUnsub = null;
}

watch(
  () => [props.job.id, props.job.tradespersonId, props.isTradie] as const,
  ([jobId, tradespersonId]) => {
    detach();
    timeUnsub = subscribeJobTimeEntries(
      jobId,
      tradespersonId,
      (list) => (timeEntries.value = list),
      () => (timeEntries.value = []),
    );
    if (props.isTradie) {
      expensesUnsub = subscribeJobExpenses(
        jobId,
        tradespersonId,
        (list) => (expenses.value = list),
        () => (expenses.value = []),
      );
    } else {
      expenses.value = [];
    }
  },
  { immediate: true },
);

// Agreed fixed price (pre-tax, net of any discount) from the accepted quote —
// the baseline a fixed-price job is built on. Hourly jobs quote an estimate,
// not a fixed price, so we don't surface it there.
const fixedPriceCents = ref(0);
watch(
  () => [props.job.id, isFixed.value] as const,
  async ([jobId, fixed]) => {
    if (!fixed) {
      fixedPriceCents.value = 0;
      return;
    }
    try {
      const q = await getQuoteByJobId(jobId);
      fixedPriceCents.value = q ? Math.max(0, q.subtotal - q.discountAmount) : 0;
    } catch {
      fixedPriceCents.value = 0;
    }
  },
  { immediate: true },
);

// Refresh roughly every 30s so a running clock's accrued cost doesn't sit
// stale. Per-second precision lives on the TimeTrackerCard below; this is a
// summary. Only mounted while the Work order tab is open, so no idle interval.
ticker = window.setInterval(() => (nowMs.value = Date.now()), 30_000);
onBeforeUnmount(() => {
  detach();
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
});

const tally = computed(() =>
  rollUpJobCharges({
    timeEntries: timeEntries.value,
    expenses: expenses.value,
    extras: props.extras,
    tradespersonId: props.job.tradespersonId,
    billingType: props.billingType,
    nowMs: nowMs.value,
  }),
);

// Fixed jobs: agreed price + change orders. Hourly: the running actuals.
const grandTotalCents = computed(() => fixedPriceCents.value + tally.value.totalCents);
const hasAnything = computed(() => grandTotalCents.value > 0);

const showCreateInvoice = computed(
  () => props.isTradie && props.job.status === "in_progress",
);
const createInvoiceLabel = computed(() =>
  props.job.clientChangesRequestedAt ? "Update invoice" : "Create invoice",
);
</script>

<template>
  <div class="bs-card p-3 border-l-4 border-l-[color:var(--bs-blue)]">
    <header class="flex items-center justify-between gap-2">
      <h3 class="font-semibold text-sm flex items-center gap-2">
        <i class="pi pi-calculator text-[color:var(--bs-blue)]"></i>
        Charges so far
      </h3>
      <span class="text-lg font-bold tabular-nums">{{ money(grandTotalCents) }}</span>
    </header>

    <dl v-if="hasAnything" class="mt-2 text-sm space-y-1">
      <!-- Fixed-price baseline — always shown on a fixed job so it's clear what
           the agreed quote is charging before any extras. -->
      <div v-if="isFixed" class="flex items-center justify-between gap-2">
        <dt class="text-[color:var(--bs-muted)] flex items-center gap-1.5">
          <i class="pi pi-file-check text-xs"></i> Fixed price
        </dt>
        <dd class="tabular-nums">{{ money(fixedPriceCents) }}</dd>
      </div>
      <div v-if="tally.timeCents > 0" class="flex items-center justify-between gap-2">
        <dt class="text-[color:var(--bs-muted)] flex items-center gap-1.5">
          <i class="pi pi-clock text-xs"></i> Time
        </dt>
        <dd class="tabular-nums">{{ money(tally.timeCents) }}</dd>
      </div>
      <div v-if="tally.expenseCents > 0" class="flex items-center justify-between gap-2">
        <dt class="text-[color:var(--bs-muted)] flex items-center gap-1.5">
          <i class="pi pi-receipt text-xs"></i> Materials
        </dt>
        <dd class="tabular-nums">{{ money(tally.expenseCents) }}</dd>
      </div>
      <div v-if="tally.changeOrderCents > 0" class="flex items-center justify-between gap-2">
        <dt class="text-[color:var(--bs-muted)] flex items-center gap-1.5">
          <i class="pi pi-plus-circle text-xs"></i> Change orders
        </dt>
        <dd class="tabular-nums">{{ money(tally.changeOrderCents) }}</dd>
      </div>
    </dl>
    <p v-else class="mt-2 text-xs text-[color:var(--bs-muted)]">
      Nothing billed yet — tracked time, receipts and approved change orders add up here.
    </p>

    <p class="text-[11px] text-[color:var(--bs-muted)] mt-2">Pre-tax — tax is added on the invoice.</p>

    <Button
      v-if="showCreateInvoice"
      :label="createInvoiceLabel"
      :icon="job.clientChangesRequestedAt ? 'pi pi-pencil' : 'pi pi-receipt'"
      class="w-full mt-3"
      @click="emit('create-invoice')"
    />
  </div>
</template>
