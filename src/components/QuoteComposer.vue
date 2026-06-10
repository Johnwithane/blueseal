<script setup lang="ts">
// Shared quote-composer body. Hosts the line items / discount / upfront fee /
// validity / terms+note / summary editor and emits a normalized payload that
// both submitQuote (direct-request job, via QuoteSheet) and submitApplication
// (marketplace bid, via the apply form) consume. The host owns fetching the
// tradesperson's hourly rate and the submit action; this component is purely
// the editor.
import { computed, ref, watch, nextTick } from "vue";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Textarea from "primevue/textarea";
import SelectButton from "primevue/selectbutton";
import Message from "primevue/message";
import { recomputeTotals } from "@/firebase/services/invoices";
import type { InvoiceDiscount, LineItem, LineItemKind, QuoteUpfrontFee } from "@/firebase/interfaces";
import type { SubmitQuoteUpfrontFee } from "@/firebase/services/quotes";
import { useFormatters } from "@/composables/useFormatters";

export interface QuoteComposerPayload {
  lineItems: LineItem[];
  discount: InvoiceDiscount | null;
  estimatedHours: number | null;
  validUntilDays: number;
  terms: string;
  noteToClient: string;
  upfrontFee: SubmitQuoteUpfrontFee | null;
  // Projected start date as a YYYY-MM-DD calendar string (or null), and a
  // free-text duration estimate. The server stores the date at UTC midnight.
  proposedStartDate: string | null;
  estimatedDuration: string;
}

export interface QuoteComposerState {
  valid: boolean;
  payload: QuoteComposerPayload | null;
  totals: { subtotal: number; discountAmount: number; taxTotal: number; total: number };
  upfrontPreviewCents: number;
  hasHourlyLineWithoutRate: boolean;
  hasIncompleteLine: boolean;
}

// Hydration seed for resend/edit (QuoteSheet) — pass null for a fresh form.
export interface QuoteComposerInitial {
  lineItems?: LineItem[];
  discount?: InvoiceDiscount | null;
  terms?: string;
  noteToClient?: string;
  estimatedHours?: number | null;
  upfrontFee?: QuoteUpfrontFee | null;
  /** YYYY-MM-DD calendar string (host converts any stored Timestamp first). */
  proposedStartDate?: string | null;
  estimatedDuration?: string;
}

const props = defineProps<{
  /** Tradesperson's stored hourly rate (cents/hr), or null when unset. */
  hourlyRateCents: number | null;
  /** Seed values for resend/edit. A new (changing) object re-hydrates. */
  initial?: QuoteComposerInitial | null;
  /** Hide the note-to-client field (the marketplace apply form has its own
   *  cover message, so the quote note would be redundant there). */
  hideNote?: boolean;
}>();

const emit = defineEmits<{
  "update:state": [state: QuoteComposerState];
}>();

const { money, date } = useFormatters();

// Per-row local state — both hourly + flat inputs are kept so flipping kind
// never loses typing.
interface UiLine {
  kind: LineItemKind;
  description: string;
  hoursInput: number;
  rateOverrideDollars: number | null;
  amountDollars: number;
  taxRatePercent: number;
}
const lines = ref<UiLine[]>([]);

const kindOptions: { label: string; value: LineItemKind; icon: string }[] = [
  { label: "Hourly", value: "hourly", icon: "pi pi-clock" },
  { label: "Flat rate", value: "labour", icon: "pi pi-wrench" },
  { label: "Materials", value: "materials", icon: "pi pi-box" },
];

type DiscountMode = "off" | "percent" | "fixed";
const discountMode = ref<DiscountMode>("off");
const discountValue = ref<number>(0);
const discountLabel = ref<string>("");
const discountModeOptions = [
  { label: "No discount", value: "off" },
  { label: "Percent %", value: "percent" },
  { label: "Fixed $", value: "fixed" },
];

const validUntilDays = ref<number>(14);
const terms = ref<string>("");
const noteToClient = ref<string>("");

// Timing the client wants to see up front: when work can start and how long
// it should take. Start date is a native YYYY-MM-DD string; duration is free
// text so "half a day" / "2–3 days" / "1 week" all work.
const proposedStartDate = ref<string>("");
const estimatedDuration = ref<string>("");

type UpfrontMode = "off" | "percent" | "fixed";
const upfrontMode = ref<UpfrontMode>("off");
const upfrontPercent = ref<number>(20);
const upfrontDollars = ref<number>(0);
const upfrontModeOptions = [
  { label: "No upfront fee", value: "off" },
  { label: "Percent %", value: "percent" },
  { label: "Fixed $", value: "fixed" },
];
const UPFRONT_PERCENT_CAP = 50;

const centsFromDollars = (d: number) => Math.round((d ?? 0) * 100);

function effectiveRateCents(l: UiLine): number | null {
  if (l.kind !== "hourly") return null;
  if (l.rateOverrideDollars != null && l.rateOverrideDollars > 0) {
    return centsFromDollars(l.rateOverrideDollars);
  }
  if (props.hourlyRateCents != null && props.hourlyRateCents > 0) {
    return props.hourlyRateCents;
  }
  return null;
}

const hasHourlyLineWithoutRate = computed(() =>
  lines.value.some((l) => l.kind === "hourly" && effectiveRateCents(l) == null),
);

function isLineIncomplete(l: UiLine): boolean {
  const hasDesc = l.description.trim().length > 0;
  if (hasDesc) return false;
  if (l.kind === "hourly") {
    return (l.hoursInput ?? 0) > 0 || (l.rateOverrideDollars ?? 0) > 0;
  }
  return (l.amountDollars ?? 0) > 0;
}
const hasIncompleteLine = computed(() => lines.value.some(isLineIncomplete));

function buildLineItems(): LineItem[] {
  const out: LineItem[] = [];
  for (const l of lines.value) {
    const desc = l.description.trim();
    if (!desc) continue;
    const taxRate = Math.max(0, Math.min(0.5, (l.taxRatePercent ?? 0) / 100));
    if (l.kind === "hourly") {
      const rate = effectiveRateCents(l);
      if (rate == null || rate <= 0) continue;
      if (!l.hoursInput || l.hoursInput <= 0) continue;
      out.push({ kind: "hourly", description: desc, quantity: l.hoursInput, unitPrice: rate, taxRate });
    } else {
      const amount = centsFromDollars(l.amountDollars);
      if (amount <= 0) continue;
      out.push({ kind: l.kind, description: desc, quantity: 1, unitPrice: amount, taxRate });
    }
  }
  return out;
}

const previewLines = computed<LineItem[]>(() => buildLineItems());

const discountForCallable = computed<InvoiceDiscount | null>(() => {
  if (discountMode.value === "off") return null;
  const label = discountLabel.value.trim() || null;
  if (discountMode.value === "percent") {
    return { type: "percent", value: Math.max(0, Math.min(100, discountValue.value ?? 0)), label };
  }
  return { type: "fixed", value: Math.max(0, centsFromDollars(discountValue.value ?? 0)), label };
});

const totals = computed(() => recomputeTotals(previewLines.value, discountForCallable.value));

const upfrontPreviewCents = computed<number>(() => {
  if (upfrontMode.value === "off") return 0;
  const preTaxBase = Math.max(0, totals.value.subtotal - totals.value.discountAmount);
  if (preTaxBase <= 0) return 0;
  if (upfrontMode.value === "percent") {
    const pct = Math.max(0, Math.min(UPFRONT_PERCENT_CAP, upfrontPercent.value ?? 0));
    return Math.round((preTaxBase * pct) / 100);
  }
  const dollars = Math.max(0, upfrontDollars.value ?? 0);
  return Math.min(Math.round(dollars * 100), preTaxBase);
});

const upfrontFeeForCallable = computed<SubmitQuoteUpfrontFee | null>(() => {
  if (upfrontMode.value === "off") return null;
  if (upfrontPreviewCents.value <= 0) return null;
  if (upfrontMode.value === "percent") {
    const pct = Math.max(0, Math.min(UPFRONT_PERCENT_CAP, upfrontPercent.value ?? 0));
    if (pct <= 0) return null;
    return { type: "percent", bps: Math.round(pct * 100) };
  }
  return { type: "fixed", amountCents: upfrontPreviewCents.value };
});

const validUntilPreview = computed(() => {
  const d = new Date();
  d.setDate(d.getDate() + validUntilDays.value);
  return date(d);
});

const totalHourlyHours = computed(() => {
  let h = 0;
  for (const li of previewLines.value) {
    if (li.kind === "hourly") h += li.quantity;
  }
  return h > 0 ? h : null;
});

function emptyLine(kind: LineItemKind): UiLine {
  return { kind, description: "", hoursInput: 0, rateOverrideDollars: null, amountDollars: 0, taxRatePercent: 13 };
}

function defaultKind(): LineItemKind {
  return props.hourlyRateCents != null && props.hourlyRateCents > 0 ? "hourly" : "labour";
}

function toggleRateOverride(i: number) {
  lines.value = lines.value.map((l, idx) => {
    if (idx !== i || l.kind !== "hourly") return l;
    if (l.rateOverrideDollars == null) {
      const seed = props.hourlyRateCents != null ? props.hourlyRateCents / 100 : 0;
      return { ...l, rateOverrideDollars: seed };
    }
    return { ...l, rateOverrideDollars: null };
  });
}

function addLine(kind?: LineItemKind) {
  lines.value = [...lines.value, emptyLine(kind ?? defaultKind())];
  void nextTick(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>(".quote-composer-line-description input");
    inputs[inputs.length - 1]?.focus();
  });
}

function removeLine(i: number) {
  lines.value = lines.value.filter((_, idx) => idx !== i);
  if (lines.value.length === 0) lines.value = [emptyLine(defaultKind())];
}

function setLineKind(i: number, kind: LineItemKind) {
  lines.value = lines.value.map((l, idx) => (idx === i ? { ...l, kind } : l));
}

function reset() {
  lines.value = [emptyLine(defaultKind())];
  discountMode.value = "off";
  discountValue.value = 0;
  discountLabel.value = "";
  validUntilDays.value = 14;
  terms.value = "";
  noteToClient.value = "";
  proposedStartDate.value = "";
  estimatedDuration.value = "";
  upfrontMode.value = "off";
  upfrontPercent.value = 20;
  upfrontDollars.value = 0;
}

// Seed from an existing quote (resend/edit). Maps legacy lines without `kind`
// to a sensible fallback so re-sending an older quote doesn't lose data.
function hydrate(initial: QuoteComposerInitial) {
  lines.value = (initial.lineItems ?? []).map((li): UiLine => {
    const kind: LineItemKind = li.kind ?? "labour";
    if (kind === "hourly") {
      const storedRate = li.unitPrice ?? 0;
      const profileRate = props.hourlyRateCents ?? 0;
      const isOverride = storedRate > 0 && storedRate !== profileRate;
      return {
        kind: "hourly",
        description: li.description,
        hoursInput: li.quantity,
        rateOverrideDollars: isOverride ? storedRate / 100 : null,
        amountDollars: 0,
        taxRatePercent: Math.round((li.taxRate ?? 0) * 10000) / 100,
      };
    }
    return {
      kind,
      description: li.description,
      hoursInput: 0,
      rateOverrideDollars: null,
      amountDollars: (li.unitPrice ?? 0) / 100,
      taxRatePercent: Math.round((li.taxRate ?? 0) * 10000) / 100,
    };
  });
  if (lines.value.length === 0) lines.value = [emptyLine(defaultKind())];
  const d = initial.discount ?? null;
  if (d) {
    discountMode.value = d.type;
    discountValue.value = d.type === "fixed" ? d.value / 100 : d.value;
    discountLabel.value = d.label ?? "";
  } else {
    discountMode.value = "off";
  }
  terms.value = initial.terms ?? "";
  noteToClient.value = initial.noteToClient ?? "";
  proposedStartDate.value = initial.proposedStartDate ?? "";
  estimatedDuration.value = initial.estimatedDuration ?? "";
  const fee = initial.upfrontFee ?? null;
  if (fee) {
    if (fee.type === "percent") {
      upfrontMode.value = "percent";
      upfrontPercent.value = Math.round(fee.bps / 100);
    } else {
      upfrontMode.value = "fixed";
      upfrontDollars.value = (fee.amountCents ?? 0) / 100;
    }
  } else {
    upfrontMode.value = "off";
  }
}

// Re-seed whenever the `initial` identity changes (host swaps it on open).
watch(
  () => props.initial,
  (init) => {
    if (init) hydrate(init);
    else reset();
  },
  { immediate: true },
);

// Emit the normalized state on every relevant change so the host can drive the
// submit button label + payload reactively.
const state = computed<QuoteComposerState>(() => {
  const items = previewLines.value;
  const valid = items.length > 0 && totals.value.total > 0 && !hasHourlyLineWithoutRate.value;
  return {
    valid,
    payload: valid
      ? {
          lineItems: items,
          discount: discountForCallable.value,
          estimatedHours: totalHourlyHours.value,
          validUntilDays: validUntilDays.value,
          terms: terms.value.trim(),
          noteToClient: noteToClient.value.trim(),
          upfrontFee: upfrontFeeForCallable.value,
          proposedStartDate: proposedStartDate.value || null,
          estimatedDuration: estimatedDuration.value.trim(),
        }
      : null,
    totals: totals.value,
    upfrontPreviewCents: upfrontPreviewCents.value,
    hasHourlyLineWithoutRate: hasHourlyLineWithoutRate.value,
    hasIncompleteLine: hasIncompleteLine.value,
  };
});
watch(state, (s) => emit("update:state", s), { immediate: true, deep: true });
</script>

<template>
  <div class="space-y-4">
    <!-- Line items -->
    <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
      <header class="flex items-center gap-2 mb-2">
        <i class="pi pi-list text-[color:var(--bs-blue)]"></i>
        <h4 class="font-semibold text-sm">Scope of work</h4>
      </header>
      <p class="text-xs text-[color:var(--bs-muted)] mb-2">
        Mix hourly time, flat-rate fees, and parts/materials. Hourly uses your
        profile rate ({{ hourlyRateCents ? money(hourlyRateCents) + "/hr" : "not set" }}).
      </p>

      <Message v-if="hasHourlyLineWithoutRate" severity="warn" :closable="false" class="mb-3 text-xs">
        One or more Hourly lines have no rate. Set a profile rate, use
        "Override rate for this line", or switch the row to Flat rate.
      </Message>

      <ul class="space-y-3">
        <li
          v-for="(l, i) in lines"
          :key="i"
          class="rounded-lg border border-[color:var(--bs-border)] p-3"
        >
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="flex items-center gap-1 flex-wrap">
              <button
                v-for="opt in kindOptions"
                :key="opt.value"
                type="button"
                class="quote-kind-chip"
                :class="{ 'quote-kind-chip--active': l.kind === opt.value }"
                @click="setLineKind(i, opt.value)"
              >
                <i :class="opt.icon"></i>
                {{ opt.label }}
              </button>
            </div>
            <button
              type="button"
              class="text-red-500 hover:text-red-600 p-1"
              aria-label="Remove line"
              @click="removeLine(i)"
            >
              <i class="pi pi-times text-sm"></i>
            </button>
          </div>

          <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">Description</label>
          <InputText
            v-model="l.description"
            :placeholder="
              l.kind === 'hourly'
                ? 'e.g. On-site diagnostics'
                : l.kind === 'materials'
                ? 'e.g. Pipe + fittings'
                : 'e.g. Install new shower mixer'
            "
            maxlength="200"
            :invalid="isLineIncomplete(l)"
            class="quote-composer-line-description w-full text-sm"
          />
          <p v-if="isLineIncomplete(l)" class="text-[11px] text-red-600 mt-1">
            Add a description so this line counts toward the total.
          </p>

          <!-- Hourly -->
          <div v-if="l.kind === 'hourly'" class="mt-2">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">Estimated hours</label>
                <InputNumber
                  v-model="l.hoursInput"
                  :min="0"
                  :max-fraction-digits="2"
                  suffix=" hrs"
                  :input-class="'text-sm w-full'"
                  fluid
                />
              </div>
              <div>
                <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">
                  Rate
                  <span class="text-[color:var(--bs-muted)]">
                    ({{ l.rateOverrideDollars == null ? "from profile" : "custom" }})
                  </span>
                </label>
                <InputNumber
                  v-if="l.rateOverrideDollars != null"
                  v-model="l.rateOverrideDollars"
                  mode="currency"
                  currency="CAD"
                  :min="0"
                  :max-fraction-digits="2"
                  suffix="/hr"
                  :input-class="'text-sm w-full'"
                  fluid
                />
                <div
                  v-else
                  class="rounded border border-[color:var(--bs-border)] bg-[#f9fafb] px-3 py-2 text-sm"
                >
                  {{ hourlyRateCents ? money(hourlyRateCents) + "/hr" : "Not set" }}
                </div>
              </div>
            </div>
            <div class="flex items-center justify-between mt-1.5 text-xs">
              <button
                type="button"
                class="text-[color:var(--bs-blue)] hover:underline"
                @click="toggleRateOverride(i)"
              >
                <i :class="l.rateOverrideDollars == null ? 'pi pi-pencil text-[10px]' : 'pi pi-replay text-[10px]'"></i>
                {{ l.rateOverrideDollars == null ? "Override rate for this line" : "Use profile rate" }}
              </button>
              <span v-if="effectiveRateCents(l) && l.hoursInput > 0" class="text-[color:var(--bs-muted)]">
                {{ l.hoursInput }} hrs × {{ money(effectiveRateCents(l)!) }}/hr =
                <span class="font-semibold text-[color:var(--bs-text)]">{{
                  money(Math.round(l.hoursInput * (effectiveRateCents(l) ?? 0)))
                }}</span>
                <span class="text-[10px]"> est.</span>
              </span>
            </div>
          </div>

          <!-- Flat rate / Materials -->
          <div v-else class="mt-2">
            <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">
              {{ l.kind === "materials" ? "Cost to client" : "Amount" }}
            </label>
            <InputNumber
              v-model="l.amountDollars"
              mode="currency"
              currency="CAD"
              :min="0"
              :max-fraction-digits="2"
              :input-class="'text-sm w-full font-semibold'"
              fluid
            />
          </div>

          <!-- Tax per line -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <div>
              <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">Tax rate</label>
              <InputNumber
                v-model="l.taxRatePercent"
                :min="0"
                :max="50"
                :max-fraction-digits="2"
                :step="1"
                suffix=" %"
                :input-class="'text-sm w-full'"
                fluid
              />
            </div>
          </div>
        </li>
      </ul>

      <div class="mt-3 grid grid-cols-3 gap-2">
        <button type="button" class="quote-add-btn" @click="addLine('hourly')">
          <i class="pi pi-plus text-xs"></i> Hourly
        </button>
        <button type="button" class="quote-add-btn" @click="addLine('labour')">
          <i class="pi pi-plus text-xs"></i> Flat rate
        </button>
        <button type="button" class="quote-add-btn" @click="addLine('materials')">
          <i class="pi pi-plus text-xs"></i> Materials
        </button>
      </div>
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
          <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">Label (optional)</label>
          <InputText
            v-model="discountLabel"
            placeholder="e.g. New customer"
            maxlength="60"
            class="text-sm w-full"
          />
        </div>
      </div>
    </section>

    <!-- Upfront fee -->
    <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
      <header class="flex items-center gap-2 mb-2">
        <i class="pi pi-wallet text-[color:var(--bs-blue)]"></i>
        <h4 class="font-semibold text-sm">Upfront fee</h4>
      </header>
      <p class="text-xs text-[color:var(--bs-muted)] mb-2">
        Require part of the quote before you start. Job moves to
        <span class="font-semibold">Awaiting upfront payment</span>
        on acceptance; work begins once you mark it received. The amount is
        credited against the final invoice.
      </p>
      <SelectButton
        v-model="upfrontMode"
        :options="upfrontModeOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        class="text-xs"
      />
      <div v-if="upfrontMode !== 'off'" class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">
            {{ upfrontMode === "percent" ? `Percent (max ${UPFRONT_PERCENT_CAP}%)` : "Amount" }}
          </label>
          <InputNumber
            v-if="upfrontMode === 'percent'"
            v-model="upfrontPercent"
            :min="1"
            :max="UPFRONT_PERCENT_CAP"
            :max-fraction-digits="0"
            suffix=" %"
            :input-class="'text-sm w-full'"
            fluid
          />
          <InputNumber
            v-else
            v-model="upfrontDollars"
            :min="0"
            :max-fraction-digits="2"
            mode="currency"
            currency="CAD"
            :input-class="'text-sm w-full'"
            fluid
          />
        </div>
        <div class="flex flex-col justify-end">
          <span class="text-[11px] text-[color:var(--bs-muted)]">Client pays upfront</span>
          <span class="font-semibold text-sm text-[color:var(--bs-blue-dark)]">
            {{ money(upfrontPreviewCents) }}
          </span>
        </div>
      </div>
    </section>

    <!-- Validity -->
    <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
      <label class="font-semibold text-sm flex items-center gap-2 mb-2">
        <i class="pi pi-calendar text-[color:var(--bs-blue)]"></i>
        Valid for
      </label>
      <div class="flex items-center gap-3">
        <InputNumber
          v-model="validUntilDays"
          :min="1"
          :max="180"
          :max-fraction-digits="0"
          suffix=" days"
          :input-class="'text-sm w-full'"
          class="w-32"
        />
        <span class="text-xs text-[color:var(--bs-muted)]">until {{ validUntilPreview }}</span>
      </div>
    </section>

    <!-- Timing: when work can start + how long it should take. Shown to the
         client alongside the quote so availability is part of the comparison. -->
    <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
      <header class="flex items-center gap-2 mb-2">
        <i class="pi pi-calendar-plus text-[color:var(--bs-blue)]"></i>
        <h4 class="font-semibold text-sm">Timing</h4>
      </header>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">
            Projected start date
          </label>
          <input
            v-model="proposedStartDate"
            type="date"
            class="quote-composer-date w-full rounded-md border border-[color:var(--bs-border)] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">
            Expected duration
          </label>
          <InputText
            v-model="estimatedDuration"
            placeholder="e.g. 2–3 days"
            maxlength="80"
            class="w-full text-sm"
          />
        </div>
      </div>
    </section>

    <!-- Note + terms -->
    <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
      <template v-if="!hideNote">
        <label class="font-semibold text-sm flex items-center gap-2 mb-2">
          <i class="pi pi-comment text-[color:var(--bs-blue)]"></i>
          Note to client <span class="font-normal text-[color:var(--bs-muted)]">(optional)</span>
        </label>
        <Textarea
          v-model="noteToClient"
          rows="2"
          maxlength="500"
          placeholder="Short cover note — shown above the quote and in the chat notification."
          class="w-full text-sm"
        />
      </template>
      <label class="font-semibold text-sm mt-3 mb-2 block">
        Terms / exclusions <span class="font-normal text-[color:var(--bs-muted)]">(optional)</span>
      </label>
      <Textarea
        v-model="terms"
        rows="3"
        maxlength="2000"
        placeholder="Scope assumptions, what's not included, deposit policy, etc."
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
          <dt>{{ totalHourlyHours ? "Estimated total" : "Total" }}</dt>
          <dd>{{ money(totals.total) }}</dd>
        </div>
        <p v-if="totalHourlyHours" class="text-[11px] text-[color:var(--bs-muted)] pt-1">
          <i class="pi pi-clock text-[10px]"></i>
          Hourly time is an estimate — the final invoice bills the actual hours worked.
        </p>
        <div
          v-if="upfrontPreviewCents > 0"
          class="flex items-center justify-between text-xs text-[color:var(--bs-blue-dark)] pt-1"
        >
          <dt class="flex items-center gap-1">
            <i class="pi pi-wallet text-[10px]"></i>
            Upfront before work starts
          </dt>
          <dd class="font-semibold">{{ money(upfrontPreviewCents) }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.quote-kind-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  border: 1px solid var(--bs-border);
  background: white;
  color: var(--bs-muted);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.quote-kind-chip:hover {
  border-color: var(--bs-blue);
  color: var(--bs-blue);
}
.quote-kind-chip--active {
  background: var(--bs-blue);
  border-color: var(--bs-blue);
  color: white;
}
.quote-kind-chip--active:hover {
  color: white;
}
.quote-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.4rem 0.5rem;
  border-radius: 0.5rem;
  border: 1px solid var(--bs-border);
  background: white;
  color: var(--bs-blue);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}
.quote-add-btn:hover {
  border-color: var(--bs-blue);
  background: var(--bs-surface-alt);
}
</style>
