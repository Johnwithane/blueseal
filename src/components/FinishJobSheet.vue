<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Textarea from "primevue/textarea";
import SelectButton from "primevue/selectbutton";
import Message from "primevue/message";
import Tag from "primevue/tag";
import { submitJobForApproval } from "@/firebase/services/jobs";
import { recomputeTotals } from "@/firebase/services/invoices";
import { getQuoteByJobId } from "@/firebase/services/quotes";
import { subscribeJobTimeEntries, entryBillable } from "@/firebase/services/timeEntries";
import { subscribeJobExpenses } from "@/firebase/services/expenses";
import type {
  ExpenseDoc,
  InvoiceDiscount,
  JobExtraDoc,
  LineItem,
  TimeEntryDoc,
  WithId,
} from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  visible: boolean;
  jobId: string;
  tradespersonId: string;
  clientId: string;
  billingType: "hourly" | "fixed";
  // Change orders on the job — approved flat ones become invoice lines; approved
  // hourly ones are billed via their clocked time (labelled in the rollup).
  extras: WithId<JobExtraDoc>[];
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  submitted: [];
}>();

const { money } = useFormatters();
const toast = useToast();

// ----- data: live subscriptions to time + expenses on this job -----
const timeEntries = ref<WithId<TimeEntryDoc>[]>([]);
const expenses = ref<WithId<ExpenseDoc>[]>([]);
const loadingTime = ref(false);
const loadingExpenses = ref(false);
const nowMs = ref(Date.now());
let timeUnsub: (() => void) | null = null;
let expensesUnsub: (() => void) | null = null;
let ticker: number | null = null;

// ----- local form state -----
interface ExtraRow {
  description: string;
  unitPriceDollars: number;
  taxRate: number;
}
const extraRows = ref<ExtraRow[]>([]);

// Quick-pick presets for the common one-off charges QA flagged (truck/callout,
// travel, tool rental, etc.). Deliberately free-form: the chip only seeds the
// description, and the tradesperson types the amount — their travel charge can
// differ from the on-site rate, tool rental varies job to job. It just saves
// re-typing the same labels every wrap-up.
const EXTRA_PRESETS = [
  "Travel time",
  "Truck / callout charge",
  "Tool rental",
  "Disposal fee",
  "Sourcing fee",
] as const;

// Quote line items, hydrated once when the sheet opens. Only the FIXED rows
// (materials, flat labour) are pre-filled — the tradesperson can edit amounts /
// taxes per row or remove what no longer applies. HOURLY quote rows are
// deliberately EXCLUDED: that labour is billed from clocked time via the
// time-tracker rollup, so pre-filling the quote's estimated hours would bill
// the estimate instead of the hours actually worked. See hydrateFromQuote.
const quoteRows = ref<ExtraRow[]>([]);
const loadingQuote = ref(false);
const quoteLoaded = ref(false);

type DiscountMode = "off" | "percent" | "fixed";
const discountMode = ref<DiscountMode>("off");
const discountValue = ref<number>(0);
const discountLabel = ref<string>("");
const discountModeOptions = [
  { label: "No discount", value: "off" },
  { label: "Percent %", value: "percent" },
  { label: "Fixed $", value: "fixed" },
];

const noteToClient = ref("");

const submitting = ref(false);

// ----- lifecycle -----
function attach() {
  detach();
  loadingTime.value = true;
  loadingExpenses.value = true;
  timeUnsub = subscribeJobTimeEntries(
    props.jobId,
    props.tradespersonId,
    (list) => {
      timeEntries.value = list;
      loadingTime.value = false;
    },
    () => {
      timeEntries.value = [];
      loadingTime.value = false;
    },
  );
  expensesUnsub = subscribeJobExpenses(
    props.jobId,
    props.tradespersonId,
    (list) => {
      expenses.value = list;
      loadingExpenses.value = false;
    },
    () => {
      expenses.value = [];
      loadingExpenses.value = false;
    },
  );
  ticker = window.setInterval(() => (nowMs.value = Date.now()), 1000);
}
function detach() {
  timeUnsub?.();
  expensesUnsub?.();
  if (ticker !== null) window.clearInterval(ticker);
  timeUnsub = null;
  expensesUnsub = null;
  ticker = null;
}
async function hydrateFromQuote() {
  loadingQuote.value = true;
  quoteLoaded.value = false;
  try {
    const q = await getQuoteByJobId(props.jobId);
    if (!q?.lineItems?.length) {
      quoteRows.value = [];
      return;
    }
    // Skip hourly rows — they're billed from clocked time (the Time section
    // above / the server's time rollup), NOT the quote's estimate. Pulling them
    // in here was billing quoted hours and ignoring the tracked ones. Fixed rows
    // (materials, flat labour) are the real agreed charges and stay.
    quoteRows.value = q.lineItems
      .filter((li) => li.kind !== "hourly")
      .map((li) => {
        const qty = li.quantity ?? 1;
        const unit = li.unitPrice ?? 0;
        return {
          description: li.description ?? "",
          unitPriceDollars: (qty * unit) / 100,
          taxRate: li.taxRate ?? 0,
        };
      });
  } catch {
    // Quote read can fail (legacy job without a quote, permission edge).
    // Leave quoteRows empty — sheet still works from time + expenses + extras.
    quoteRows.value = [];
  } finally {
    loadingQuote.value = false;
    quoteLoaded.value = true;
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      // Reset form each open so closing + re-opening starts clean.
      extraRows.value = [];
      quoteRows.value = [];
      quoteLoaded.value = false;
      discountMode.value = "off";
      discountValue.value = 0;
      discountLabel.value = "";
      noteToClient.value = "";
      attach();
      void hydrateFromQuote();
    } else {
      detach();
    }
  },
);
onBeforeUnmount(detach);

// ----- derived: rollups + preview totals mirror the server-side submit callable -----
interface Rollup {
  hours: number;
  amount: number;
  ids: string[];
}

// id → description for every change order (labels hourly change-order time).
const extraDescById = computed(() => {
  const m = new Map<string, string>();
  for (const ex of props.extras) m.set(ex.id, ex.description?.trim() || "Change order");
  return m;
});

// Un-invoiced time entries grouped by (kind, extraId, rate) — mirrors the
// server roll-up so the preview matches the final invoice. Running entries are
// included (the server auto-closes them on submit). $0 base labour on a fixed
// job is dropped (time-only record, not a charge).
const timeRollup = computed(() => {
  const map = new Map<string, Rollup & { label: string; rate: number }>();
  for (const e of timeEntries.value) {
    if (e.invoicedAt != null) continue;
    if (e.tradespersonId !== props.tradespersonId) continue;
    const { elapsedMs, billedAmount } = entryBillable(e, nowMs.value);
    if (elapsedMs <= 0) continue;
    const rate = Math.max(0, Math.floor(e.hourlyRateSnapshot));
    const kind = e.kind ?? "labour";
    if (kind === "labour" && rate === 0 && props.billingType === "fixed") continue;
    const extraId = kind === "extra" ? (e.extraId ?? "") : "";
    const label =
      kind === "travel"
        ? "Travel"
        : kind === "extra"
          ? (extraDescById.value.get(extraId) ?? "Change order")
          : "Labour";
    const key = `${kind}|${extraId}|${rate}`;
    const bucket = map.get(key) ?? { hours: 0, amount: 0, ids: [], label, rate };
    bucket.hours += elapsedMs / 3_600_000;
    bucket.amount += billedAmount;
    bucket.ids.push(e.id);
    map.set(key, bucket);
  }
  return map;
});

// Fixed-price jobs don't bill receipts — they're cost-tracking only, mirroring
// the server's rollUpExpenses gate. Out-of-scope materials ride a change order.
const costTrackingOnly = computed(() => props.billingType === "fixed");
const billableExpenses = computed(() =>
  costTrackingOnly.value
    ? []
    : expenses.value.filter((x) => !x.invoicedAt && (x.billedAmount ?? 0) > 0),
);

const hasRunningEntry = computed(() =>
  timeEntries.value.some(
    (e) => e.endedAt === null && e.tradespersonId === props.tradespersonId,
  ),
);

const round2 = (n: number) => Math.round(n * 100) / 100;
const centsFromDollars = (d: number) => Math.round((d ?? 0) * 100);

// Synthesize the line-item list the way the server will build it, so the
// totals preview matches what the client will see after submit.
const previewLines = computed<LineItem[]>(() => {
  const lines: LineItem[] = [];
  for (const b of timeRollup.value.values()) {
    if (b.hours <= 0) continue;
    const qty = round2(b.hours);
    const rateTail = b.rate === 0 ? "" : ` @ $${(b.rate / 100).toFixed(2)}/hr`;
    lines.push({
      description: `${b.label}: ${qty}h${rateTail}`,
      quantity: qty,
      unitPrice: b.rate,
      taxRate: 0,
    });
  }
  for (const x of billableExpenses.value) {
    lines.push({
      description: x.description?.trim() || "Materials",
      quantity: 1,
      unitPrice: x.billedAmount,
      taxRate: 0,
    });
  }
  // Approved flat change orders — the server pulls these in too.
  for (const ex of props.extras) {
    if (ex.status !== "approved" || ex.invoicedAt != null) continue;
    if (ex.billingType !== "flat") continue;
    const amount = Math.max(0, Math.floor(ex.flatAmountCents ?? 0));
    if (amount <= 0) continue;
    lines.push({
      description: ex.description?.trim() || "Change order",
      quantity: 1,
      unitPrice: amount,
      taxRate: 0,
    });
  }
  // Quote rows render first so the invoice line ordering matches what the
  // client originally saw on the quote — easier to reconcile at payment time.
  for (const r of quoteRows.value) {
    if (!r.description.trim()) continue;
    const unitPrice = centsFromDollars(r.unitPriceDollars);
    if (unitPrice <= 0) continue;
    lines.push({
      description: r.description.trim(),
      quantity: 1,
      unitPrice,
      taxRate: r.taxRate ?? 0,
    });
  }
  for (const r of extraRows.value) {
    if (!r.description.trim()) continue;
    const unitPrice = centsFromDollars(r.unitPriceDollars);
    if (unitPrice <= 0) continue;
    lines.push({
      description: r.description.trim(),
      quantity: 1,
      unitPrice,
      taxRate: r.taxRate ?? 0,
    });
  }
  return lines;
});

const discountForCallable = computed<InvoiceDiscount | null>(() => {
  if (discountMode.value === "off") return null;
  const label = discountLabel.value.trim() || null;
  if (discountMode.value === "percent") {
    return {
      type: "percent",
      value: Math.max(0, Math.min(100, discountValue.value ?? 0)),
      label,
    };
  }
  return {
    type: "fixed",
    value: Math.max(0, centsFromDollars(discountValue.value ?? 0)),
    label,
  };
});

const totals = computed(() => recomputeTotals(previewLines.value, discountForCallable.value));

// recomputeTotals silently clamps an over-large fixed discount to the
// subtotal (→ $0 invoice). Block submit and point at the number instead.
const discountExceedsSubtotal = computed(
  () =>
    discountMode.value === "fixed" &&
    centsFromDollars(discountValue.value ?? 0) > totals.value.subtotal,
);

const canSubmit = computed(
  () => !submitting.value && totals.value.total > 0 && !discountExceedsSubtotal.value,
);

const totalTimeLabel = computed(() => {
  let total = 0;
  for (const e of timeEntries.value) {
    if (e.invoicedAt != null) continue;
    if (e.tradespersonId !== props.tradespersonId) continue;
    total += entryBillable(e, nowMs.value).elapsedMs;
  }
  const totalSeconds = Math.floor(total / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h === 0 && m === 0) return "No time logged";
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
});

// ----- actions -----
function addExtraRow() {
  extraRows.value = [
    ...extraRows.value,
    { description: "", unitPriceDollars: 0, taxRate: 0 },
  ];
  // Focus the newly-added description field on the next tick so the user can
  // type immediately instead of hunting for the input.
  void nextTick(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>(
      ".finish-sheet-extra-description input",
    );
    inputs[inputs.length - 1]?.focus();
  });
}

// Seed a row from a preset chip. Description is pre-filled, so focus the
// amount field (not the description) so the tradesperson types the charge.
function addExtraPreset(label: string) {
  extraRows.value = [
    ...extraRows.value,
    { description: label, unitPriceDollars: 0, taxRate: 0 },
  ];
  void nextTick(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>(
      ".finish-sheet-extra-amount input",
    );
    inputs[inputs.length - 1]?.focus();
  });
}

function removeExtraRow(i: number) {
  extraRows.value = extraRows.value.filter((_, idx) => idx !== i);
}

function removeQuoteRow(i: number) {
  quoteRows.value = quoteRows.value.filter((_, idx) => idx !== i);
}

async function onSubmit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    // Quote rows + freeform extras both submit as extraLineItems — the
    // server doesn't distinguish their origin. Quote first to preserve the
    // ordering the client saw originally.
    const extraLineItems: LineItem[] = [...quoteRows.value, ...extraRows.value]
      .filter((r) => r.description.trim() && centsFromDollars(r.unitPriceDollars) > 0)
      .map((r) => ({
        description: r.description.trim(),
        quantity: 1,
        unitPrice: centsFromDollars(r.unitPriceDollars),
        taxRate: r.taxRate ?? 0,
      }));
    await submitJobForApproval({
      jobId: props.jobId,
      extraLineItems,
      discount: discountForCallable.value,
      noteToClient: noteToClient.value.trim(),
    });
    toast.success(
      "Sent to client",
      "They'll review the work and approve to receive the invoice.",
    );
    emit("submitted");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't send for approval", humanizeError(e));
  } finally {
    submitting.value = false;
  }
}

function close() {
  if (submitting.value) return;
  emit("update:visible", false);
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :closable="!submitting"
    :dismissable-mask="false"
    :draggable="false"
    header="Finish job"
    :pt="{ root: { class: 'finish-sheet-dialog' } }"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <div class="space-y-4">
      <!-- Time summary -->
      <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <header class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-2">
            <i class="pi pi-clock text-[color:var(--bs-blue)]"></i>
            <h4 class="font-semibold text-sm">Time</h4>
          </div>
          <Tag :value="totalTimeLabel" severity="secondary" />
        </header>
        <Message
          v-if="hasRunningEntry"
          severity="info"
          :closable="false"
          class="mb-2 text-xs"
        >
          Your clock is still running — we'll close it when you send.
        </Message>
        <div v-if="loadingTime" class="text-xs text-[color:var(--bs-muted)]">Loading…</div>
        <div v-else-if="timeRollup.size === 0" class="text-xs text-[color:var(--bs-muted)]">
          No billable time on this job.
        </div>
        <ul v-else class="text-sm space-y-1">
          <li
            v-for="[key, b] in timeRollup.entries()"
            :key="key"
            class="flex items-center justify-between gap-2"
          >
            <span>
              <span class="text-[color:var(--bs-muted)]">{{ b.label }}</span>
              {{ round2(b.hours) }}h
              <span v-if="b.rate > 0" class="text-[color:var(--bs-muted)] text-xs">
                @ {{ money(b.rate) }}/hr
              </span>
              <span v-else class="text-[color:var(--bs-muted)] text-xs">(no rate set)</span>
            </span>
            <span class="font-medium">{{ money(b.amount) }}</span>
          </li>
        </ul>
      </section>

      <!-- Expenses summary -->
      <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <header class="flex items-center gap-2 mb-2">
          <i class="pi pi-receipt text-[color:var(--bs-blue)]"></i>
          <h4 class="font-semibold text-sm">Expenses</h4>
        </header>
        <div v-if="loadingExpenses" class="text-xs text-[color:var(--bs-muted)]">Loading…</div>
        <div
          v-else-if="costTrackingOnly"
          class="text-xs text-[color:var(--bs-muted)]"
        >
          Receipts aren't billed on a fixed-price job — they stay on your records.
        </div>
        <div
          v-else-if="billableExpenses.length === 0"
          class="text-xs text-[color:var(--bs-muted)]"
        >
          No expenses to bill.
        </div>
        <ul v-else class="text-sm space-y-1">
          <li
            v-for="x in billableExpenses"
            :key="x.id"
            class="flex items-center justify-between gap-2"
          >
            <span class="truncate">{{ x.description?.trim() || "Materials" }}</span>
            <span class="font-medium shrink-0">{{ money(x.billedAmount) }}</span>
          </li>
        </ul>
        <p class="text-[11px] text-[color:var(--bs-muted)] mt-2">
          <template v-if="costTrackingOnly">
            To charge for an out-of-scope material, propose a change order — the
            client approves it and it rides on this invoice.
          </template>
          <template v-else>
            Markups + categories live in the Expenses card on the Work order tab —
            edit there before finishing if anything's off.
          </template>
        </p>
      </section>

      <!-- From the original quote. Pre-filled when the sheet opens so the
           invoice starts from "what the client agreed to", with time +
           expenses + extras layered on top. Each row is editable and
           removable so the tradesperson can adjust for what actually
           happened on-site without re-typing the whole quote. -->
      <section
        v-if="loadingQuote || quoteRows.length > 0"
        class="rounded-lg border border-[color:var(--bs-border)] p-3"
      >
        <header class="flex items-center gap-2 mb-2">
          <i class="pi pi-file text-[color:var(--bs-blue)]"></i>
          <h4 class="font-semibold text-sm">From your quote</h4>
        </header>
        <div v-if="loadingQuote" class="text-xs text-[color:var(--bs-muted)]">
          Loading quote…
        </div>
        <template v-else>
          <p class="text-[11px] text-[color:var(--bs-muted)] mb-2 leading-snug">
            Pre-filled from the quote the client accepted. Edit amounts or
            remove rows if the actual work differed.
          </p>
          <ul class="space-y-2">
            <li
              v-for="(r, i) in quoteRows"
              :key="`q-${i}`"
              class="grid grid-cols-[1fr_8rem_auto] gap-2 items-start"
            >
              <InputText
                v-model="r.description"
                placeholder="Description"
                maxlength="200"
                class="w-full text-sm"
              />
              <InputNumber
                v-model="r.unitPriceDollars"
                mode="currency"
                currency="CAD"
                :min="0"
                :max-fraction-digits="2"
                :input-class="'text-sm w-full text-right'"
                fluid
              />
              <Button
                text
                icon="pi pi-times"
                size="small"
                severity="danger"
                aria-label="Remove line"
                @click="removeQuoteRow(i)"
              />
            </li>
          </ul>
        </template>
      </section>

      <!-- Extra line items — the home for everything outside time + receipts:
           truck/callout charges, travel, tool rental, disposal, and any
           change/extra the job picked up along the way. Approved by the
           client when they sign off on this invoice. -->
      <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <header class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-2">
            <i class="pi pi-plus-circle text-[color:var(--bs-blue)]"></i>
            <h4 class="font-semibold text-sm">Extras &amp; charges</h4>
          </div>
          <Button
            label="Add"
            icon="pi pi-plus"
            size="small"
            outlined
            @click="addExtraRow"
          />
        </header>
        <p class="text-xs text-[color:var(--bs-muted)] mb-2 leading-snug">
          Truck/callout, travel, tool rental, disposal — plus any change or
          extra outside the original quote. These ride on this invoice, so the
          client approves them when they sign off.
        </p>
        <!-- Preset chips: one tap adds a labelled row, then type the amount. -->
        <div class="flex flex-wrap gap-1.5 mb-3">
          <button
            v-for="preset in EXTRA_PRESETS"
            :key="preset"
            type="button"
            class="finish-sheet-preset-chip"
            @click="addExtraPreset(preset)"
          >
            <i class="pi pi-plus text-[10px]"></i>
            {{ preset }}
          </button>
        </div>
        <ul v-if="extraRows.length" class="space-y-2">
          <li
            v-for="(r, i) in extraRows"
            :key="i"
            class="grid grid-cols-[1fr_8rem_auto] gap-2 items-start"
          >
            <InputText
              v-model="r.description"
              placeholder="e.g. Trip charge"
              maxlength="200"
              class="finish-sheet-extra-description w-full text-sm"
            />
            <InputNumber
              v-model="r.unitPriceDollars"
              mode="currency"
              currency="CAD"
              :min="0"
              :max-fraction-digits="2"
              :input-class="'finish-sheet-extra-amount text-sm w-full text-right'"
              fluid
            />
            <Button
              text
              icon="pi pi-times"
              size="small"
              severity="danger"
              aria-label="Remove line"
              @click="removeExtraRow(i)"
            />
          </li>
        </ul>
      </section>

      <!-- Discount -->
      <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <header class="flex items-center gap-2 mb-2">
          <i class="pi pi-percentage text-[color:var(--bs-blue)]"></i>
          <h4 class="font-semibold text-sm">Discount</h4>
        </header>
        <SelectButton
          v-model="discountMode"
          :options="discountModeOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          class="text-xs"
        />
        <div v-if="discountMode !== 'off'" class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">
              {{ discountMode === "percent" ? "Percent off" : "Amount off" }}
            </label>
            <InputNumber
              v-model="discountValue"
              :min="0"
              :max="discountMode === 'percent' ? 100 : undefined"
              :max-fraction-digits="2"
              :mode="discountMode === 'fixed' ? 'currency' : undefined"
              :currency="discountMode === 'fixed' ? 'CAD' : undefined"
              :suffix="discountMode === 'percent' ? ' %' : undefined"
              :input-class="'text-sm w-full'"
              fluid
            />
          </div>
          <div>
            <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">
              Label (optional)
            </label>
            <InputText
              v-model="discountLabel"
              placeholder="e.g. Repeat customer"
              maxlength="60"
              class="text-sm w-full"
            />
          </div>
        </div>
        <p
          v-if="discountExceedsSubtotal"
          class="text-[11px] text-[color:var(--bs-danger)] mt-2"
        >
          This discount is more than the subtotal ({{ money(totals.subtotal) }}) — reduce it
          before sending.
        </p>
      </section>

      <!-- Note to client -->
      <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <label
          for="finish-note"
          class="font-semibold text-sm flex items-center gap-2 mb-2"
        >
          <i class="pi pi-comment text-[color:var(--bs-blue)]"></i>
          Note to client (optional)
        </label>
        <Textarea
          id="finish-note"
          v-model="noteToClient"
          rows="3"
          maxlength="500"
          placeholder="What was done, anything they should know about the work, etc."
          class="w-full text-sm"
        />
      </section>

      <!-- Summary -->
      <section
        class="rounded-lg border-2 border-[color:var(--bs-blue)] p-3"
        style="background: color-mix(in srgb, var(--bs-blue-light) 30%, transparent);"
      >
        <h4 class="font-semibold text-sm mb-2">Summary</h4>
        <dl class="text-sm space-y-1">
          <div class="flex items-center justify-between">
            <dt class="text-[color:var(--bs-muted)]">Subtotal</dt>
            <dd>{{ money(totals.subtotal) }}</dd>
          </div>
          <div
            v-if="totals.discountAmount > 0"
            class="flex items-center justify-between text-[color:var(--bs-blue)]"
          >
            <dt>
              Discount
              <span v-if="discountLabel.trim()" class="text-xs text-[color:var(--bs-muted)]">
                ({{ discountLabel.trim() }})
              </span>
            </dt>
            <dd>−{{ money(totals.discountAmount) }}</dd>
          </div>
          <div class="flex items-center justify-between">
            <dt class="text-[color:var(--bs-muted)]">Tax</dt>
            <dd>{{ money(totals.taxTotal) }}</dd>
          </div>
          <div class="flex items-center justify-between text-base font-bold pt-1 border-t mt-1">
            <dt>Total</dt>
            <dd>{{ money(totals.total) }}</dd>
          </div>
        </dl>
        <p class="text-[11px] text-[color:var(--bs-muted)] mt-2 leading-snug">
          Tax is rolled up from each line item's rate (Canadian retail convention —
          applied after discount). Edit individual rates in the Invoice section after
          the client approves if anything needs adjusting.
        </p>
      </section>
    </div>

    <template #footer>
      <div class="flex flex-col-reverse gap-2 w-full sm:flex-row sm:items-center">
        <Button label="Cancel" text :disabled="submitting" class="w-full sm:w-auto" @click="close" />
        <span class="hidden flex-1 sm:block"></span>
        <Button
          :label="
            totals.total > 0
              ? `Send for approval — ${money(totals.total)}`
              : 'Add something to bill first'
          "
          icon="pi pi-send"
          :loading="submitting"
          :disabled="!canSubmit"
          class="w-full sm:w-auto"
          @click="onSubmit"
        />
      </div>
    </template>
  </Dialog>
</template>

<style>
/* Full-screen on mobile, centered modal on desktop. PrimeVue's default
   Dialog is too narrow on phones for a multi-section form. The dialog
   itself is a flex column so the footer pins to the bottom (sticky bottom
   bar look) while the body scrolls. */
.finish-sheet-dialog {
  width: 100vw;
  max-width: 640px;
  margin: 0;
  display: flex;
  flex-direction: column;
}
.finish-sheet-dialog .p-dialog-content {
  overflow-y: auto;
  flex: 1 1 auto;
}
.finish-sheet-dialog .p-dialog-footer {
  border-top: 1px solid var(--bs-border);
  background: white;
  padding: 0.75rem 1rem;
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}
@media (max-width: 639px) {
  .finish-sheet-dialog {
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
}

/* Quick-pick chips for common extra charges. */
.finish-sheet-preset-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--bs-border);
  background: white;
  color: var(--bs-blue);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.1s, background 0.1s;
}
.finish-sheet-preset-chip:hover {
  border-color: var(--bs-blue);
  background: var(--bs-surface-alt);
}
</style>
