<script setup lang="ts">
// At-a-glance "charges so far" for the Work order tab — the running, pre-tax
// total of everything added while the job runs (tracked time, billable
// receipts, approved change orders). Both parties see it; only the tradesperson
// gets the Create invoice button (which opens the wrap-up sheet, same as the
// Invoice tab). The figure uses rollUpJobCharges so it agrees with the invoice
// it previews.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import { subscribeJobTimeEntries } from "@/firebase/services/timeEntries";
import { subscribeJobExpenses } from "@/firebase/services/expenses";
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

// ----- live data: time (both parties) + expenses (tradesperson only) -----
// Receipts are tradesperson-only by rule, so the client can't subscribe to
// them — their tally is time + change orders, with a note that materials land
// on the invoice.
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

const hasCharges = computed(() => tally.value.totalCents > 0);

const isFixed = computed(() => props.billingType === "fixed");

// The client can't see receipts here; flag it on hourly jobs so a lower total
// than the eventual invoice doesn't read as a discrepancy. (Fixed jobs never
// bill receipts — the fixed-price note covers that instead.)
const showMaterialsNote = computed(() => props.isClient && !isFixed.value);

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
      <span class="text-lg font-bold tabular-nums">{{ money(tally.totalCents) }}</span>
    </header>

    <p class="text-[11px] text-[color:var(--bs-muted)] mt-0.5">
      A running, pre-tax total of the work added so far. Tax and anything from
      the original quote are settled when the invoice is built.
    </p>

    <!-- Fixed-price jobs bill the agreed quote, not tracked time or receipts,
         so the running total here only moves with approved change orders. Spell
         that out so an empty/low total reads as "as expected", not "missing". -->
    <p
      v-if="isFixed"
      class="text-[11px] text-[color:var(--bs-muted)] mt-2 flex items-start gap-1.5"
    >
      <i class="pi pi-info-circle mt-0.5 text-[color:var(--bs-blue)]"></i>
      <span>
        This is a <strong>fixed-price</strong> job — the agreed quote covers the
        work. Tracked time and receipts are kept for the record but don't add to
        the total; only client-approved change orders do.
      </span>
    </p>

    <!-- Breakdown — only the lines that actually carry a charge, to keep it
         scannable. -->
    <dl v-if="hasCharges" class="mt-2 text-sm space-y-1">
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
      Nothing billed yet — tracked time, receipts and approved change orders show
      up here as you add them below.
    </p>

    <p v-if="showMaterialsNote" class="text-[11px] text-[color:var(--bs-muted)] mt-2">
      Any receipts/materials the tradesperson logs are added when they build your
      invoice.
    </p>

    <Button
      v-if="showCreateInvoice"
      :label="createInvoiceLabel"
      :icon="job.clientChangesRequestedAt ? 'pi pi-pencil' : 'pi pi-receipt'"
      class="w-full mt-3"
      @click="emit('create-invoice')"
    />
  </div>
</template>
