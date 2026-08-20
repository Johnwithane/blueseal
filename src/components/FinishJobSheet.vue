<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import NumberField from "@/components/NumberField.vue";
import Textarea from "primevue/textarea";
import SelectButton from "primevue/selectbutton";
import Message from "primevue/message";
import Tag from "primevue/tag";
import ManualTimeEntryDialog from "@/components/ManualTimeEntryDialog.vue";
import AddExpenseDialog from "@/components/AddExpenseDialog.vue";
import InvoiceBreakdown from "@/components/InvoiceBreakdown.vue";
import { submitJobForApproval } from "@/firebase/services/jobs";
import { getInvoiceByJobId, recomputeTotals } from "@/firebase/services/invoices";
import { getQuoteByJobId } from "@/firebase/services/quotes";
import { draftInvoiceNoteWithAi } from "@/firebase/services/aiDrafts";
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
import { usePaywallStore } from "@/stores/paywall";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  visible: boolean;
  jobId: string;
  tradespersonId: string;
  clientId: string | null;
  billingType: "hourly" | "fixed";
  // Change orders on the job — approved flat ones become invoice lines; approved
  // hourly ones are billed via their clocked time (labelled in the rollup).
  extras: WithId<JobExtraDoc>[];
  /** Upfront fee the client has already PAID (cents); 0/absent when none.
   *  Credited on the invoice, and the invoice may never total less than it. */
  upfrontFeePaidCents?: number;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  submitted: [];
}>();

const { money } = useFormatters();
const toast = useToast();
const paywall = usePaywallStore();

// ----- data: live subscriptions to time + expenses on this job -----
const timeEntries = ref<WithId<TimeEntryDoc>[]>([]);
const expenses = ref<WithId<ExpenseDoc>[]>([]);
const loadingTime = ref(false);
const loadingExpenses = ref(false);
const nowMs = ref(Date.now());
let timeUnsub: (() => void) | null = null;
let expensesUnsub: (() => void) | null = null;
let ticker: number | null = null;

// Approved HOURLY change orders the tradie can log time against (mirrors
// WorkOrderTab / TimeTrackerCard). Passed to the manual-time dialog so a
// forgotten session can be added without leaving the wrap-up.
const approvedHourlyExtras = computed(() =>
  props.extras
    .filter((e) => e.status === "approved" && e.billingType === "hourly")
    .map((e) => ({ id: e.id, description: e.description, hourlyRateCents: e.hourlyRateCents ?? 0 })),
);
const showManualTime = ref(false);
const showAddExpense = ref(false);

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

// Fixed (materials / flat labour) line items from the accepted quote. On a
// FIXED-price job the agreed quote IS the bill, so its rows are PRE-ADDED to the
// invoice (the tradesperson can still tap one off); on an HOURLY job they stay
// an opt-in reference — each row lands on the invoice only when tapped "Add".
// HOURLY quote rows are always EXCLUDED: that labour is billed from clocked time
// via the time-tracker rollup, so surfacing the quote's estimated hours would
// invite billing the estimate instead of the hours actually worked. The panel
// stays visible on every wizard step. See hydrateSheet.
interface QuoteRefRow {
  description: string;
  amountDollars: number;
  taxRate: number;
  added: boolean;
}
const quoteRefRows = ref<QuoteRefRow[]>([]);
const loadingQuote = ref(false);
const quoteRefOpen = ref(true);

const addedQuoteCount = computed(() => quoteRefRows.value.filter((r) => r.added).length);
const allQuoteAdded = computed(
  () => quoteRefRows.value.length > 0 && quoteRefRows.value.every((r) => r.added),
);
// On a fixed job the panel IS the agreed price (pre-added); on hourly it's an
// opt-in reference. The label/copy follow so neither side is misread.
const quotePanelLabel = computed(() =>
  props.billingType === "fixed" ? "Agreed fixed price" : "From your quote",
);

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

// Fixed-price jobs don't bill receipts — they're cost-tracking only, mirroring
// the server's rollUpExpenses gate. Out-of-scope materials ride a change order.
// Declared up here on purpose: FINISH_STEPS reads it, and the watch(FINISH_STEPS)
// below evaluates eagerly during setup — a later declaration is a use-before-init
// crash (the whole setup throws, so the sheet never opens).
const costTrackingOnly = computed(() => props.billingType === "fixed");

// Guided walkthrough: reveal the wrap-up one section at a time, ending on the
// full form (summary + send). Skippable for tradies who just want the form.
// Sections are v-show'd, so nothing typed is lost moving back and forth.
const FINISH_STEPS = computed<{ key: string; title: string; hint: string }[]>(() => {
  const steps = [
    {
      key: "time",
      title: "Time",
      hint: "The tracked time that will be billed. Running timers close when you send.",
    },
    {
      key: "expenses",
      title: "Expenses",
      hint: costTrackingOnly.value
        ? "Receipts on this fixed-price job are records only — nothing bills here."
        : "Receipts and materials billed through with your markup.",
    },
  ];
  steps.push(
    {
      key: "extras",
      title: "Extras & charges",
      hint: "Travel, callout, disposal — anything outside time and receipts.",
    },
    {
      key: "wrapup",
      title: "Discount & note",
      hint: "An optional discount and a short note to the client.",
    },
  );
  return steps;
});
const wizardStep = ref<number | null>(0);
const inWizard = computed(() => wizardStep.value !== null);
// The step list can shrink under the user (the quote step disappears when the
// quote loads with no fixed rows) — clamp instead of pointing past the end.
watch(FINISH_STEPS, (steps) => {
  if (wizardStep.value !== null && wizardStep.value >= steps.length) {
    wizardStep.value = steps.length - 1;
  }
});
function stepShown(key: string): boolean {
  if (wizardStep.value === null) return true;
  return FINISH_STEPS.value[wizardStep.value]?.key === key;
}
function wizardNext() {
  const i = wizardStep.value;
  if (i === null) return;
  wizardStep.value = i + 1 >= FINISH_STEPS.value.length ? null : i + 1;
}
function wizardBack() {
  if (wizardStep.value && wizardStep.value > 0) wizardStep.value -= 1;
}
function wizardSkip() {
  wizardStep.value = null;
}

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
async function hydrateSheet() {
  loadingQuote.value = true;
  try {
    const [inv, q] = await Promise.all([
      getInvoiceByJobId(props.jobId),
      getQuoteByJobId(props.jobId),
    ]);

    // Re-supply the invoice's FREE-FORM lines (no `id` — hand-written in the
    // editor, started as a manual invoice, or added on a previous wrap-up) as
    // editable extra rows. submitJobForApproval keeps only id-bearing rows
    // (pulled time / expenses / change orders) and rebuilds the rest from what
    // this sheet sends, so anything not re-supplied here is DROPPED from the
    // invoice. That contract only held while the sheet was the sole author of
    // free-form lines; a manually written invoice would otherwise lose every
    // line the moment the tradesperson wrapped the job up.
    const freeform = (inv?.lineItems ?? []).filter((li) => !li.id);
    extraRows.value = freeform.map((li) => ({
      description: li.description ?? "",
      unitPriceDollars: ((li.quantity ?? 1) * (li.unitPrice ?? 0)) / 100,
      taxRate: li.taxRate ?? 0,
    }));
    // The invoice's own discount is the live truth once one exists — carry it
    // in so a re-submit doesn't silently drop it (the callable overwrites
    // `discount` with whatever this sheet sends).
    if (inv?.discount) {
      discountMode.value = inv.discount.type;
      discountValue.value =
        inv.discount.type === "fixed" ? inv.discount.value / 100 : inv.discount.value;
      discountLabel.value = inv.discount.label ?? "";
    }

    if (!q?.lineItems?.length) {
      quoteRefRows.value = [];
      return;
    }
    // Fixed-price job: the agreed quote IS the bill, so pre-add its rows. Hourly
    // job: keep them an opt-in reference (added only when tapped) — that labour
    // bills from clocked time, so auto-adding the estimate would double-charge.
    // Skip the pre-add entirely when the invoice already carries free-form
    // lines: those came back as extra rows above (on a fixed job they ARE the
    // quote rows from the last submit), so pre-adding would bill them twice.
    const preAdd = props.billingType === "fixed" && freeform.length === 0;
    // Skip hourly rows — they're billed from clocked time (the Time section
    // above / the server's time rollup), NOT the quote's estimate. Surfacing
    // them here would invite billing quoted hours and ignoring the tracked ones.
    // Fixed rows (materials, flat labour) are the real agreed charges.
    quoteRefRows.value = q.lineItems
      .filter((li) => li.kind !== "hourly")
      .map((li) => {
        const qty = li.quantity ?? 1;
        const unit = li.unitPrice ?? 0;
        return {
          description: li.description ?? "",
          amountDollars: (qty * unit) / 100,
          taxRate: li.taxRate ?? 0,
          added: preAdd,
        };
      });
    // Carry the quote's own discount onto the invoice so the auto-filled total
    // matches the agreed price exactly — the rows above are stored PRE-discount,
    // so without this a discounted fixed quote would over-bill. Fixed jobs only,
    // and only when the tradesperson hasn't already set a discount on this sheet
    // (they can still adjust it afterwards to take more off).
    if (preAdd && q.discount && discountMode.value === "off") {
      discountMode.value = q.discount.type;
      discountValue.value =
        q.discount.type === "fixed" ? q.discount.value / 100 : q.discount.value;
      discountLabel.value = q.discount.label ?? "";
    }
  } catch {
    // Quote read can fail (legacy job without a quote, permission edge).
    // Leave the reference empty — sheet still works from time + expenses + extras.
    quoteRefRows.value = [];
  } finally {
    loadingQuote.value = false;
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      // Reset form each open so closing + re-opening starts clean.
      extraRows.value = [];
      quoteRefRows.value = [];
      quoteRefOpen.value = true;
      discountMode.value = "off";
      discountValue.value = 0;
      discountLabel.value = "";
      noteToClient.value = "";
      wizardStep.value = 0;
      attach();
      void hydrateSheet();
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

// (costTrackingOnly is declared near the top — FINISH_STEPS needs it early.)
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
  // Quote rows the tradie chose to add — kept ahead of free-form extras so the
  // invoice line ordering matches what the client originally saw on the quote.
  for (const r of quoteRefRows.value) {
    if (!r.added || !r.description.trim()) continue;
    const unitPrice = centsFromDollars(r.amountDollars);
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

// The invoice may never total LESS than the upfront fee the client already
// paid — the credit clamps at $0 due, so the shortfall would silently vanish.
// Mirrors the submitJobForApproval server check.
const upfrontCredit = computed(() => Math.max(0, props.upfrontFeePaidCents ?? 0));
const belowUpfrontFloor = computed(
  () => upfrontCredit.value > 0 && totals.value.total > 0 && totals.value.total < upfrontCredit.value,
);
const amountDueAfterCredit = computed(() =>
  Math.max(0, totals.value.total - upfrontCredit.value),
);

// Preview: assemble the exact in-memory shape InvoiceBreakdown renders for the
// client, from the same synthesized lines + totals the submit callable will use.
// `total` is the post-credit amount due (InvoiceBreakdown shows the upfront-fee
// credit row, then "Total due"), mirroring the stored invoice doc. The server
// builds plain {description,quantity,unitPrice,taxRate} lines too (no `kind`),
// so the preview is faithful to what the client will see — not an approximation.
const showPreview = ref(false);
const previewInvoice = computed(() => ({
  lineItems: previewLines.value,
  subtotal: totals.value.subtotal,
  discount: discountForCallable.value,
  discountAmount: totals.value.discountAmount,
  taxTotal: totals.value.taxTotal,
  total: amountDueAfterCredit.value,
  upfrontFeeCredit: upfrontCredit.value > 0 ? { amountCents: upfrontCredit.value } : null,
}));

const canSubmit = computed(
  () =>
    !submitting.value &&
    totals.value.total > 0 &&
    !discountExceedsSubtotal.value &&
    !belowUpfrontFloor.value,
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

// Reference → invoice: tap a quote item to add it (or remove it). It only
// counts toward the invoice while `added` is true.
function toggleQuoteRow(i: number) {
  quoteRefRows.value = quoteRefRows.value.map((r, idx) =>
    idx === i ? { ...r, added: !r.added } : r,
  );
}

// One-tap add-all / clear-all for the common case (a fixed-price job where the
// whole invoice is the agreed quote).
function toggleAllQuoteRows() {
  const next = !allQuoteAdded.value;
  quoteRefRows.value = quoteRefRows.value.map((r) => ({ ...r, added: next }));
}

// AI-drafts the wrap-up note from the job's tracked work (time notes,
// expenses, change orders). The numbers self-populate; the note is the one
// authored part. Free today; behind the server-side entitlement seam slated
// for Blue Seal Pro.
const draftingNote = ref(false);
async function onDraftNote() {
  if (draftingNote.value) return;
  draftingNote.value = true;
  try {
    noteToClient.value = await draftInvoiceNoteWithAi(props.jobId);
    toast.success("Note drafted", "Give it a quick read before sending.");
  } catch (e) {
    if (paywall.fromError(e)) return;
    toast.error("Couldn't draft the note", humanizeError(e));
  } finally {
    draftingNote.value = false;
  }
}

async function onSubmit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    // Added quote items + freeform extras both submit as extraLineItems — the
    // server doesn't distinguish their origin. Quote first to preserve the
    // ordering the client saw originally.
    const addedQuoteRows = quoteRefRows.value
      .filter((r) => r.added)
      .map((r) => ({
        description: r.description,
        unitPriceDollars: r.amountDollars,
        taxRate: r.taxRate,
      }));
    const extraLineItems: LineItem[] = [...addedQuoteRows, ...extraRows.value]
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
    if (props.clientId === null) {
      // Solo (bring-your-own-client): no approval round-trip — the invoice is
      // final immediately and the job is awaiting payment.
      toast.success(
        "Invoice finalized",
        "The job is awaiting payment — record it once your client pays.",
      );
    } else {
      toast.success(
        "Sent to client",
        "They'll review the work and approve to receive the invoice.",
      );
    }
    emit("submitted");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't finish the job", humanizeError(e));
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
      <!-- Wizard chrome: step counter, skip link, title + progress. -->
      <div v-if="inWizard">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-[color:var(--bs-muted)]">
            Step {{ (wizardStep ?? 0) + 1 }} of {{ FINISH_STEPS.length }}
          </span>
          <button
            type="button"
            class="text-xs text-[color:var(--bs-blue)] underline"
            @click="wizardSkip"
          >
            Skip — fill out the full form
          </button>
        </div>
        <h4 class="font-semibold mt-1">{{ FINISH_STEPS[wizardStep!].title }}</h4>
        <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
          {{ FINISH_STEPS[wizardStep!].hint }}
        </p>
        <div class="mt-2 flex gap-1" aria-hidden="true">
          <span
            v-for="(s, i) in FINISH_STEPS"
            :key="s.key"
            class="h-1 flex-1 rounded-full"
            :class="i <= wizardStep! ? 'bg-[color:var(--bs-blue)]' : 'bg-[color:var(--bs-border)]'"
          ></span>
        </div>
      </div>

      <!-- Time summary -->
      <section v-show="stepShown('time')" class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <header class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-2">
            <i class="pi pi-clock text-[color:var(--bs-blue)]"></i>
            <h4 class="font-semibold text-sm">Time</h4>
          </div>
          <div class="flex items-center gap-2">
            <Tag :value="totalTimeLabel" severity="secondary" />
            <Button
              label="Add time"
              icon="pi pi-plus"
              size="small"
              outlined
              @click="showManualTime = true"
            />
          </div>
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
          No billable time on this job yet — tap <span class="font-medium">Add time</span> to log a
          session you didn't clock live.
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
      <section v-show="stepShown('expenses')" class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <header class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-2">
            <i class="pi pi-receipt text-[color:var(--bs-blue)]"></i>
            <h4 class="font-semibold text-sm">Expenses</h4>
          </div>
          <Button
            label="Add expense"
            icon="pi pi-plus"
            size="small"
            outlined
            @click="showAddExpense = true"
          />
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

      <!-- Extra line items — the home for everything outside time + receipts:
           truck/callout charges, travel, tool rental, disposal, and any
           change/extra the job picked up along the way. Approved by the
           client when they sign off on this invoice. -->
      <section v-show="stepShown('extras')" class="rounded-lg border border-[color:var(--bs-border)] p-3">
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
            <NumberField
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
      <section v-show="stepShown('wrapup')" class="rounded-lg border border-[color:var(--bs-border)] p-3">
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
            <NumberField
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
      <section v-show="stepShown('wrapup')" class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <div class="flex items-center justify-between gap-2 mb-2">
          <label
            for="finish-note"
            class="font-semibold text-sm flex items-center gap-2"
          >
            <i class="pi pi-comment text-[color:var(--bs-blue)]"></i>
            Note to client (optional)
          </label>
          <Button
            label="Draft with AI"
            icon="pi pi-sparkles"
            text
            size="small"
            :loading="draftingNote"
            :disabled="draftingNote"
            @click="onDraftNote"
          />
        </div>
        <Textarea
          id="finish-note"
          v-model="noteToClient"
          rows="3"
          maxlength="500"
          placeholder="What was done, anything they should know about the work, etc."
          class="w-full text-sm"
        />
      </section>

      <!-- The accepted quote — an ever-present panel, NOT a wizard step, so it
           stays visible on every step. On a fixed-price job its rows are
           pre-added (the agreed price is the bill); on an hourly job they're an
           opt-in reference the tradie pulls from. Either way, tapping a row
           toggles whether it counts toward the invoice. -->
      <section
        v-if="loadingQuote || quoteRefRows.length > 0"
        class="rounded-lg border border-dashed border-[color:var(--bs-blue)] p-3"
        style="background: color-mix(in srgb, var(--bs-blue-light) 18%, transparent)"
      >
        <header class="flex items-center justify-between gap-2">
          <button
            type="button"
            class="flex min-w-0 items-center gap-2 text-left"
            :aria-expanded="quoteRefOpen"
            @click="quoteRefOpen = !quoteRefOpen"
          >
            <i class="pi pi-file text-[color:var(--bs-blue)]"></i>
            <span class="font-semibold text-sm">{{ quotePanelLabel }}</span>
            <span
              v-if="addedQuoteCount > 0"
              class="rounded-full bg-[color:var(--bs-blue)] px-1.5 py-0.5 text-[10px] font-semibold text-white"
            >
              {{ addedQuoteCount }} added
            </span>
            <i
              class="pi text-xs text-[color:var(--bs-muted)]"
              :class="quoteRefOpen ? 'pi-chevron-up' : 'pi-chevron-down'"
            ></i>
          </button>
          <Button
            v-if="!loadingQuote && quoteRefRows.length > 1"
            :label="allQuoteAdded ? 'Clear all' : 'Add all'"
            size="small"
            text
            @click="toggleAllQuoteRows"
          />
        </header>

        <div v-if="loadingQuote" class="mt-2 text-xs text-[color:var(--bs-muted)]">
          Loading quote…
        </div>
        <template v-else-if="quoteRefOpen">
          <p class="mt-1 mb-2 text-[11px] leading-snug text-[color:var(--bs-muted)]">
            <template v-if="props.billingType === 'fixed'">
              The price the client agreed to — already on the invoice. Tap a line to
              take it off if it no longer applies, then add a discount or extras below.
            </template>
            <template v-else>
              What the client agreed to. Add what belongs on this invoice — tap again to remove.
            </template>
          </p>
          <ul class="space-y-1.5">
            <li
              v-for="(r, i) in quoteRefRows"
              :key="`qr-${i}`"
              class="flex items-center justify-between gap-2 rounded-md border border-[color:var(--bs-border)] bg-white px-2.5 py-2"
            >
              <div class="min-w-0">
                <p class="truncate text-sm" :class="r.added ? 'font-medium' : ''">
                  {{ r.description || "Quote item" }}
                </p>
                <p class="text-[11px] text-[color:var(--bs-muted)]">
                  {{ money(centsFromDollars(r.amountDollars)) }}
                </p>
              </div>
              <button
                type="button"
                class="finish-sheet-quote-add shrink-0"
                :class="r.added ? 'finish-sheet-quote-add--on' : ''"
                :aria-pressed="r.added"
                @click="toggleQuoteRow(i)"
              >
                <i :class="r.added ? 'pi pi-check' : 'pi pi-plus'" class="text-[11px]"></i>
                {{ r.added ? "Added" : "Add" }}
              </button>
            </li>
          </ul>
        </template>
      </section>

      <!-- Summary — review only (the wizard's last stop is the full form). -->
      <section
        v-show="!inWizard"
        class="rounded-lg border-2 border-[color:var(--bs-blue)] p-3"
        style="background: color-mix(in srgb, var(--bs-blue-light) 30%, transparent);"
      >
        <div class="flex items-center justify-between gap-2 mb-2">
          <h4 class="font-semibold text-sm">Summary</h4>
          <Button
            v-if="previewLines.length"
            label="Preview invoice"
            icon="pi pi-eye"
            size="small"
            outlined
            @click="showPreview = true"
          />
        </div>
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
          <template v-if="upfrontCredit > 0">
            <div class="flex items-center justify-between text-xs text-[color:var(--bs-blue-dark)]">
              <dt class="flex items-center gap-1">
                <i class="pi pi-wallet text-[10px]"></i>
                Less upfront fee already paid
              </dt>
              <dd>−{{ money(upfrontCredit) }}</dd>
            </div>
            <div class="flex items-center justify-between text-sm font-semibold">
              <dt>Client still owes</dt>
              <dd>{{ money(amountDueAfterCredit) }}</dd>
            </div>
          </template>
        </dl>
        <p
          v-if="belowUpfrontFloor"
          class="text-[11px] text-[color:var(--bs-danger)] mt-2 leading-snug"
        >
          The total is below the {{ money(upfrontCredit) }} upfront fee the client
          already paid — the invoice must cover at least that amount. Add the
          remaining work or reduce the discount before sending.
        </p>
        <p class="text-[11px] text-[color:var(--bs-muted)] mt-2 leading-snug">
          Tax is rolled up from each line item's rate (Canadian retail convention —
          applied after discount). Edit individual rates in the Invoice section after
          the client approves if anything needs adjusting.
        </p>
      </section>
    </div>

    <template #footer>
      <!-- Wizard: Back / Next. The send button only appears on the review form. -->
      <div v-if="inWizard" class="flex w-full items-center gap-2">
        <Button
          label="Back"
          icon="pi pi-arrow-left"
          text
          :disabled="wizardStep === 0"
          @click="wizardBack"
        />
        <span class="flex-1"></span>
        <Button
          :label="wizardStep === FINISH_STEPS.length - 1 ? 'Review & send' : 'Next'"
          icon="pi pi-arrow-right"
          icon-pos="right"
          @click="wizardNext"
        />
      </div>
      <div v-else class="flex flex-col-reverse gap-2 w-full sm:flex-row sm:items-center">
        <Button label="Cancel" text :disabled="submitting" class="w-full sm:w-auto" @click="close" />
        <span class="hidden flex-1 sm:block"></span>
        <Button
          :label="
            belowUpfrontFloor
              ? `Must cover the ${money(upfrontCredit)} upfront`
              : totals.total > 0
                ? `${props.clientId === null ? 'Finalize invoice' : 'Send for approval'} — ${money(totals.total)}`
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

  <!-- Log a session that wasn't clocked live, straight from the Time step. The
       live time subscription picks it up, so the rollup + totals update here. -->
  <ManualTimeEntryDialog
    v-model:visible="showManualTime"
    :job-id="props.jobId"
    :billing-type="props.billingType"
    :approved-hourly-extras="approvedHourlyExtras"
  />

  <!-- Add a receipt / material from the Expenses step. The live expense
       subscription picks it up (billed rows on hourly jobs; record-only on
       fixed). Same dialog as the Work order tab. -->
  <AddExpenseDialog
    v-model:visible="showAddExpense"
    :job-id="props.jobId"
    :client-id="props.clientId"
    :cost-tracking-only="costTrackingOnly"
  />

  <!-- Invoice preview — renders the client-facing InvoiceBreakdown from the same
       synthesized lines + totals the submit will use, so the tradesperson sees
       every charge on one page exactly as the client will once it's sent. -->
  <Dialog
    v-model:visible="showPreview"
    modal
    header="Invoice preview"
    :draggable="false"
    :style="{ width: '34rem', maxWidth: '94vw' }"
  >
    <p class="text-xs text-[color:var(--bs-muted)] mb-3">
      This is exactly what your client will see when you send the invoice for approval.
    </p>
    <InvoiceBreakdown :invoice="previewInvoice" />
    <div
      v-if="noteToClient.trim()"
      class="mt-4 rounded-lg bg-[color:var(--bs-surface-alt,#f9fafb)] p-3"
    >
      <div class="text-xs font-semibold text-[color:var(--bs-muted)] mb-1">
        Your note to the client
      </div>
      <p class="text-sm whitespace-pre-wrap">{{ noteToClient.trim() }}</p>
    </div>
    <template #footer>
      <Button label="Close" text @click="showPreview = false" />
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

/* Add / Added toggle on each quote-reference row. Off = outlined invite to add;
   on = solid so what's already on the invoice reads at a glance. */
.finish-sheet-quote-add {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--bs-blue);
  background: white;
  color: var(--bs-blue);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.finish-sheet-quote-add:hover {
  background: var(--bs-surface-alt);
}
.finish-sheet-quote-add--on {
  background: var(--bs-blue);
  border-color: var(--bs-blue);
  color: white;
}
.finish-sheet-quote-add--on:hover {
  background: var(--bs-blue-dark);
  border-color: var(--bs-blue-dark);
  color: white;
}
</style>
