<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Textarea from "primevue/textarea";
import SelectButton from "primevue/selectbutton";
import { submitQuote, getQuoteByJobId } from "@/firebase/services/quotes";
import { recomputeTotals } from "@/firebase/services/invoices";
import type { InvoiceDiscount, LineItem } from "@/firebase/interfaces";
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

interface UiLine {
  description: string;
  quantity: number;
  unitPriceDollars: number;
  taxRate: number;
}
const lines = ref<UiLine[]>([]);

type DiscountMode = "off" | "percent" | "fixed";
const discountMode = ref<DiscountMode>("off");
const discountValue = ref<number>(0);
const discountLabel = ref<string>("");
const discountModeOptions = [
  { label: "No discount", value: "off" },
  { label: "Percent %", value: "percent" },
  { label: "Fixed $", value: "fixed" },
];

const estimatedHours = ref<number | null>(null);
const validUntilDays = ref<number>(14);
const terms = ref<string>("");
const noteToClient = ref<string>("");

const submitting = ref(false);
const priorDeclinedReason = ref<string | null>(null);
const isResend = ref(false);

const centsFromDollars = (d: number) => Math.round((d ?? 0) * 100);

const previewLines = computed<LineItem[]>(() =>
  lines.value
    .filter((l) => l.description.trim() && centsFromDollars(l.unitPriceDollars) > 0)
    .map((l) => ({
      description: l.description.trim(),
      quantity: l.quantity || 1,
      unitPrice: centsFromDollars(l.unitPriceDollars),
      taxRate: l.taxRate ?? 0,
    })),
);

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

function resetForm() {
  lines.value = [
    { description: "", quantity: 1, unitPriceDollars: 0, taxRate: 0.13 },
  ];
  discountMode.value = "off";
  discountValue.value = 0;
  discountLabel.value = "";
  estimatedHours.value = null;
  validUntilDays.value = 14;
  terms.value = "";
  noteToClient.value = "";
  priorDeclinedReason.value = null;
  isResend.value = false;
}

// Hydrate from existing quote (resend / edit-after-decline) when the sheet
// opens. Read-once is fine — the sheet is for editing a snapshot, not for
// live collaboration.
async function hydrateFromExisting() {
  const existing = await getQuoteByJobId(props.jobId);
  if (!existing) return;
  isResend.value = true;
  priorDeclinedReason.value = existing.declinedReason ?? null;
  lines.value = (existing.lineItems ?? []).map((li) => ({
    description: li.description,
    quantity: li.quantity,
    unitPriceDollars: (li.unitPrice ?? 0) / 100,
    taxRate: li.taxRate ?? 0,
  }));
  if (lines.value.length === 0) {
    lines.value = [{ description: "", quantity: 1, unitPriceDollars: 0, taxRate: 0.13 }];
  }
  const d = existing.discount ?? null;
  if (d) {
    discountMode.value = d.type;
    discountValue.value = d.type === "fixed" ? d.value / 100 : d.value;
    discountLabel.value = d.label ?? "";
  }
  estimatedHours.value = existing.estimatedHours ?? null;
  terms.value = existing.terms ?? "";
  noteToClient.value = existing.noteToClient ?? "";
}

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      resetForm();
      await hydrateFromExisting();
    }
  },
);

function addLine() {
  lines.value = [
    ...lines.value,
    { description: "", quantity: 1, unitPriceDollars: 0, taxRate: 0.13 },
  ];
  void nextTick(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>(
      ".quote-sheet-line-description input",
    );
    inputs[inputs.length - 1]?.focus();
  });
}

function removeLine(i: number) {
  lines.value = lines.value.filter((_, idx) => idx !== i);
  if (lines.value.length === 0) addLine();
}

async function onSubmit() {
  if (!canSubmit.value) return;
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
      estimatedHours: estimatedHours.value,
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
          One line per item or task. Description + price. Tax defaults to HST 13%
          per line — adjust per row if needed.
        </p>
        <ul class="space-y-2">
          <li
            v-for="(l, i) in lines"
            :key="i"
            class="grid grid-cols-[1fr_5rem_8rem_auto] gap-2 items-start"
          >
            <InputText
              v-model="l.description"
              placeholder="e.g. Install new shower mixer"
              maxlength="200"
              class="quote-sheet-line-description w-full text-sm"
            />
            <InputNumber
              v-model="l.quantity"
              :min="0"
              :max-fraction-digits="2"
              :input-class="'text-sm w-full text-right'"
              fluid
            />
            <InputNumber
              v-model="l.unitPriceDollars"
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
              @click="removeLine(i)"
            />
          </li>
        </ul>
      </section>

      <!-- Estimated hours -->
      <section class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <label class="font-semibold text-sm flex items-center gap-2 mb-2">
          <i class="pi pi-clock text-[color:var(--bs-blue)]"></i>
          Estimated hours <span class="font-normal text-[color:var(--bs-muted)]">(optional)</span>
        </label>
        <InputNumber
          v-model="estimatedHours"
          :min="0"
          :max-fraction-digits="1"
          suffix=" hours"
          placeholder="e.g. 4"
          :input-class="'text-sm w-full'"
          fluid
        />
        <p class="text-[11px] text-[color:var(--bs-muted)] mt-1">
          Hint for the client — useful for hourly-style quotes. Not used in the total.
        </p>
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
</style>
