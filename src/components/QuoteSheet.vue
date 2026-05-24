<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Textarea from "primevue/textarea";
import SelectButton from "primevue/selectbutton";
import Message from "primevue/message";
import { submitQuote, getQuoteByJobId } from "@/firebase/services/quotes";
import { recomputeTotals } from "@/firebase/services/invoices";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { useAuthStore } from "@/stores/auth";
import type { InvoiceDiscount, LineItem, LineItemKind } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  visible: boolean;
  jobId: string;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  submitted: [];
}>();

const { money, date } = useFormatters();
const toast = useToast();
const auth = useAuthStore();

// Per-row local state. Both `hoursInput` and `amountDollars` are kept
// alongside `kind` so a tradesperson can flip between types without
// losing their typing — the row just renders the matching input.
// `rateOverrideDollars` only applies to hourly rows: null means "use the
// rate from my profile", a number is a per-line override (e.g. a discount
// for this client, or a specialty rate for this task).
interface UiLine {
  kind: LineItemKind;
  description: string;
  hoursInput: number;          // only used when kind === "hourly"
  rateOverrideDollars: number | null;  // only used when kind === "hourly"
  amountDollars: number;       // only used when kind === "labour" | "materials"
  taxRate: number;
}
const lines = ref<UiLine[]>([]);

const kindOptions: { label: string; value: LineItemKind; icon: string }[] = [
  { label: "Hourly", value: "hourly", icon: "pi pi-clock" },
  { label: "Labour", value: "labour", icon: "pi pi-wrench" },
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

const submitting = ref(false);
const priorDeclinedReason = ref<string | null>(null);
const isResend = ref(false);

// Tradesperson's stored hourly rate (cents/hr). Auto-applied to every
// hourly line. Null when not yet set — hourly rows show a warning + are
// excluded from the previewed totals.
const hourlyRateCents = ref<number | null>(null);
const loadingRate = ref(false);

const centsFromDollars = (d: number) => Math.round((d ?? 0) * 100);

// Effective rate (cents/hr) for an hourly row — override wins, profile is
// the fallback. Returns null when neither is set so callers can treat the
// line as not-yet-billable.
function effectiveRateCents(l: UiLine): number | null {
  if (l.kind !== "hourly") return null;
  if (l.rateOverrideDollars != null && l.rateOverrideDollars > 0) {
    return centsFromDollars(l.rateOverrideDollars);
  }
  if (hourlyRateCents.value != null && hourlyRateCents.value > 0) {
    return hourlyRateCents.value;
  }
  return null;
}

const hasHourlyLineWithoutRate = computed(() =>
  lines.value.some((l) => l.kind === "hourly" && effectiveRateCents(l) == null),
);

// Turn the UI rows into LineItem[] for the totals preview AND the submit
// payload. Hourly rows expand to quantity = hours, unitPrice = rate;
// labour / materials rows expand to quantity = 1, unitPrice = amount.
// Drops rows the tradesperson hasn't filled in yet so the preview total
// stays sensible while editing.
function buildLineItems(): LineItem[] {
  const out: LineItem[] = [];
  for (const l of lines.value) {
    const desc = l.description.trim();
    if (!desc) continue;
    if (l.kind === "hourly") {
      const rate = effectiveRateCents(l);
      if (rate == null || rate <= 0) continue;
      if (!l.hoursInput || l.hoursInput <= 0) continue;
      out.push({
        kind: "hourly",
        description: desc,
        quantity: l.hoursInput,
        unitPrice: rate,
        taxRate: l.taxRate ?? 0,
      });
    } else {
      const amount = centsFromDollars(l.amountDollars);
      if (amount <= 0) continue;
      out.push({
        kind: l.kind,
        description: desc,
        quantity: 1,
        unitPrice: amount,
        taxRate: l.taxRate ?? 0,
      });
    }
  }
  return out;
}

const previewLines = computed<LineItem[]>(() => buildLineItems());

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
const canSubmit = computed(() => !submitting.value && totals.value.total > 0);

const validUntilPreview = computed(() => {
  const d = new Date();
  d.setDate(d.getDate() + validUntilDays.value);
  return date(d);
});

function emptyLine(kind: LineItemKind): UiLine {
  return {
    kind,
    description: "",
    hoursInput: 0,
    rateOverrideDollars: null,
    amountDollars: 0,
    taxRate: 0.13,
  };
}

// Flip a row in/out of "custom rate" mode. Off → use profile rate (null);
// on → seed with the current profile rate so the tradesperson edits from
// a sensible default rather than $0.
function toggleRateOverride(i: number) {
  lines.value = lines.value.map((l, idx) => {
    if (idx !== i || l.kind !== "hourly") return l;
    if (l.rateOverrideDollars == null) {
      const seed = hourlyRateCents.value != null ? hourlyRateCents.value / 100 : 0;
      return { ...l, rateOverrideDollars: seed };
    }
    return { ...l, rateOverrideDollars: null };
  });
}

// Pick the sensible default kind for a brand-new row: hourly when the
// tradesperson has a rate on file, labour otherwise (the most common
// fallback). The user can toggle per-row from there.
function defaultKind(): LineItemKind {
  return hourlyRateCents.value != null && hourlyRateCents.value > 0 ? "hourly" : "labour";
}

function resetForm() {
  lines.value = [emptyLine(defaultKind())];
  discountMode.value = "off";
  discountValue.value = 0;
  discountLabel.value = "";
  validUntilDays.value = 14;
  terms.value = "";
  noteToClient.value = "";
  priorDeclinedReason.value = null;
  isResend.value = false;
}

// Best-effort rate fetch on open. Failure leaves the rate null and the
// hourly rows surface a "set your rate" warning — they're skipped from
// the totals preview so the submit button stays accurate.
async function loadRate() {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  loadingRate.value = true;
  try {
    const me = await getTradesperson(uid);
    hourlyRateCents.value = me?.hourlyRate ?? null;
  } catch {
    hourlyRateCents.value = null;
  } finally {
    loadingRate.value = false;
  }
}

// Hydrate from existing quote (resend / edit-after-decline) when the sheet
// opens. Read-once is fine — the sheet is for editing a snapshot, not for
// live collaboration. Maps legacy lines without `kind` to a sensible
// fallback so re-sending an older quote doesn't lose data.
async function hydrateFromExisting() {
  const existing = await getQuoteByJobId(props.jobId);
  if (!existing) return;
  isResend.value = true;
  priorDeclinedReason.value = existing.declinedReason ?? null;
  lines.value = (existing.lineItems ?? []).map((li): UiLine => {
    const kind: LineItemKind = li.kind ?? "labour";
    if (kind === "hourly") {
      // Surface a stored rate that doesn't match the current profile rate
      // as an override — most often this is "rate was different when the
      // quote was first sent", and the tradesperson can re-toggle to pick
      // up their current profile rate if they want.
      const storedRate = li.unitPrice ?? 0;
      const profileRate = hourlyRateCents.value ?? 0;
      const isOverride = storedRate > 0 && storedRate !== profileRate;
      return {
        kind: "hourly",
        description: li.description,
        hoursInput: li.quantity,
        rateOverrideDollars: isOverride ? storedRate / 100 : null,
        amountDollars: 0,
        taxRate: li.taxRate ?? 0,
      };
    }
    return {
      kind,
      description: li.description,
      hoursInput: 0,
      rateOverrideDollars: null,
      amountDollars: (li.unitPrice ?? 0) / 100,
      taxRate: li.taxRate ?? 0,
    };
  });
  if (lines.value.length === 0) lines.value = [emptyLine(defaultKind())];
  const d = existing.discount ?? null;
  if (d) {
    discountMode.value = d.type;
    discountValue.value = d.type === "fixed" ? d.value / 100 : d.value;
    discountLabel.value = d.label ?? "";
  }
  terms.value = existing.terms ?? "";
  noteToClient.value = existing.noteToClient ?? "";
}

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      resetForm();
      await loadRate();
      await hydrateFromExisting();
    }
  },
);

function addLine() {
  lines.value = [...lines.value, emptyLine(defaultKind())];
  void nextTick(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>(
      ".quote-sheet-line-description input",
    );
    inputs[inputs.length - 1]?.focus();
  });
}

function removeLine(i: number) {
  lines.value = lines.value.filter((_, idx) => idx !== i);
  if (lines.value.length === 0) lines.value = [emptyLine(defaultKind())];
}

// Toggle row kind without losing the description / tax rate the
// tradesperson has already typed. Hours / amount stay in their own
// fields so flipping back and forth doesn't lose typing.
function setLineKind(i: number, kind: LineItemKind) {
  lines.value = lines.value.map((l, idx) => (idx === i ? { ...l, kind } : l));
}

// Derived total hours from hourly rows. Replaces the old standalone
// estimatedHours input — the sum of hourly quantities IS the estimate,
// so we just pass it through for the doc + the rendered "X hours total"
// hint on the client side.
const totalHourlyHours = computed(() => {
  let h = 0;
  for (const li of previewLines.value) {
    if (li.kind === "hourly") h += li.quantity;
  }
  return h > 0 ? h : null;
});

async function onSubmit() {
  if (!canSubmit.value) return;
  if (hasHourlyLineWithoutRate.value) {
    toast.error(
      "Hourly line is missing a rate",
      "Set a profile rate, override the rate on that line, or switch it to Labour.",
    );
    return;
  }
  const items: LineItem[] = previewLines.value;
  if (items.length === 0) {
    toast.error("Add at least one line", "A quote needs something to bill.");
    return;
  }
  submitting.value = true;
  try {
    await submitQuote({
      jobId: props.jobId,
      lineItems: items,
      discount: discountForCallable.value,
      estimatedHours: totalHourlyHours.value,
      validUntilDays: validUntilDays.value,
      terms: terms.value.trim(),
      noteToClient: noteToClient.value.trim(),
    });
    toast.success(
      isResend.value ? "Quote re-sent" : "Quote sent",
      "Your client has been notified.",
    );
    emit("submitted");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't send quote", humanizeError(e));
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
    :header="isResend ? 'Revise quote' : 'Prepare quote'"
    :pt="{ root: { class: 'quote-sheet-dialog' } }"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <div class="space-y-4">
      <!-- Prior decline reason — surfaces what the client asked to change -->
      <div
        v-if="priorDeclinedReason"
        class="rounded-lg border border-amber-300 bg-amber-50 p-3"
      >
        <div class="flex items-start gap-2">
          <i class="pi pi-info-circle text-amber-600 mt-0.5"></i>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-sm text-amber-900">Client's request</div>
            <p class="text-sm text-amber-900 mt-1 whitespace-pre-wrap">
              {{ priorDeclinedReason }}
            </p>
          </div>
        </div>
      </div>

      <!-- Line items -->
      <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <header class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-2">
            <i class="pi pi-list text-[color:var(--bs-blue)]"></i>
            <h4 class="font-semibold text-sm">Scope of work</h4>
          </div>
          <Button
            label="Add line"
            icon="pi pi-plus"
            size="small"
            outlined
            @click="addLine"
          />
        </header>
        <p class="text-xs text-[color:var(--bs-muted)] mb-2">
          Mix hourly time, flat-rate labour, and parts/materials. Hourly uses your
          profile rate ({{ hourlyRateCents ? money(hourlyRateCents) + "/hr" : "not set" }}).
        </p>

        <Message
          v-if="hasHourlyLineWithoutRate"
          severity="warn"
          :closable="false"
          class="mb-3 text-xs"
        >
          One or more Hourly lines have no rate. Set a profile rate, use
          "Override rate for this line", or switch the row to Labour.
        </Message>

        <ul class="space-y-3">
          <li
            v-for="(l, i) in lines"
            :key="i"
            class="rounded-lg border border-[color:var(--bs-border)] p-3"
          >
            <!-- Kind chips + remove button on the same row so the line type is
                 the first decision and visually frames the inputs below. -->
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
              <Button
                text
                icon="pi pi-times"
                size="small"
                severity="danger"
                aria-label="Remove line"
                @click="removeLine(i)"
              />
            </div>

            <!-- Description: same for all kinds. Hint text adapts per kind so
                 the user knows what to write. -->
            <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">
              Description
            </label>
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
              class="quote-sheet-line-description w-full text-sm"
            />

            <!-- Hourly: hours + rate (profile by default, per-line override
                 on opt-in). The "X hrs × $Y/hr = $Z" preview below uses
                 whichever rate is in effect so the math is obvious. -->
            <div v-if="l.kind === 'hourly'" class="mt-2">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">Hours</label>
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
                  <i
                    :class="
                      l.rateOverrideDollars == null
                        ? 'pi pi-pencil text-[10px]'
                        : 'pi pi-replay text-[10px]'
                    "
                  ></i>
                  {{ l.rateOverrideDollars == null ? "Override rate for this line" : "Use profile rate" }}
                </button>
                <span
                  v-if="effectiveRateCents(l) && l.hoursInput > 0"
                  class="text-[color:var(--bs-muted)]"
                >
                  {{ l.hoursInput }} hrs × {{ money(effectiveRateCents(l)!) }}/hr =
                  <span class="font-semibold text-[color:var(--bs-text)]">{{
                    money(Math.round(l.hoursInput * (effectiveRateCents(l) ?? 0)))
                  }}</span>
                </span>
              </div>
            </div>

            <!-- Labour / Materials: single amount input. quantity stays 1
                 server-side; the tradesperson types the full line total. -->
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

            <!-- Tax per line. Defaults HST 13% so the user rarely has to
                 think about it. -->
            <div class="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">
                  Tax rate
                </label>
                <InputNumber
                  v-model="l.taxRate"
                  :min="0"
                  :max="0.5"
                  :max-fraction-digits="3"
                  :step="0.01"
                  :input-class="'text-sm w-full'"
                  fluid
                />
              </div>
            </div>
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
        <div v-if="discountMode !== 'off'" class="mt-3 grid grid-cols-2 gap-2">
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
              placeholder="e.g. New customer"
              maxlength="60"
              class="text-sm w-full"
            />
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
          <span class="text-xs text-[color:var(--bs-muted)]">
            until {{ validUntilPreview }}
          </span>
        </div>
      </section>

      <!-- Note + terms -->
      <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <label
          for="quote-note"
          class="font-semibold text-sm flex items-center gap-2 mb-2"
        >
          <i class="pi pi-comment text-[color:var(--bs-blue)]"></i>
          Note to client <span class="font-normal text-[color:var(--bs-muted)]">(optional)</span>
        </label>
        <Textarea
          id="quote-note"
          v-model="noteToClient"
          rows="2"
          maxlength="500"
          placeholder="Short cover note — shown above the quote and in the chat notification."
          class="w-full text-sm"
        />

        <label for="quote-terms" class="font-semibold text-sm mt-3 mb-2 block">
          Terms / exclusions <span class="font-normal text-[color:var(--bs-muted)]">(optional)</span>
        </label>
        <Textarea
          id="quote-terms"
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
          <div
            class="flex items-center justify-between text-base font-bold pt-1 border-t mt-1"
          >
            <dt>Total</dt>
            <dd>{{ money(totals.total) }}</dd>
          </div>
        </dl>
      </section>
    </div>

    <template #footer>
      <div class="flex items-center gap-2 w-full">
        <Button label="Cancel" text :disabled="submitting" @click="close" />
        <span class="flex-1"></span>
        <Button
          :label="
            totals.total > 0
              ? isResend
                ? `Re-send quote — ${money(totals.total)}`
                : `Send quote — ${money(totals.total)}`
              : 'Add a line to bill first'
          "
          icon="pi pi-send"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="onSubmit"
        />
      </div>
    </template>
  </Dialog>
</template>

<style>
.quote-sheet-dialog {
  width: 100vw;
  max-width: 640px;
  margin: 0;
  display: flex;
  flex-direction: column;
}
.quote-sheet-dialog .p-dialog-content {
  overflow-y: auto;
  flex: 1 1 auto;
}
.quote-sheet-dialog .p-dialog-footer {
  border-top: 1px solid var(--bs-border);
  background: white;
  padding: 0.75rem 1rem;
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}
@media (max-width: 639px) {
  .quote-sheet-dialog {
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
  }
}

/* Line-kind segmented chips. Soft pill style so a row of three reads as
   "pick one" without competing with the primary form inputs below. */
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
</style>
