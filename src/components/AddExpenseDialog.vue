<script setup lang="ts">
// Popup for adding an expense — mirrors ManualTimeEntryDialog so every
// work-order addition feels the same. Two paths in one form:
//   • Upload a receipt → the doc is created immediately (status "parsing"),
//     parseReceipt OCRs it in the background, and the fields below
//     auto-populate when it returns. The tradesperson reviews, tweaks, saves.
//   • Skip the receipt and just type the fields (van-stock materials etc.).
// Cancelling after an upload deletes the just-created doc so no half-filled
// row is left behind. Mounted from ExpensesCard.
import { computed, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import NumberField from "@/components/NumberField.vue";
import Select from "primevue/select";
import Message from "primevue/message";
import {
  DEFAULT_MARKUP_PERCENT,
  EXPENSE_CATEGORY_OPTIONS,
  computeBilledAmount,
  createManualExpense,
  deleteExpense,
  parseReceiptCallable,
  subscribeExpense,
  updateExpense,
  uploadReceiptAndCreateExpense,
} from "@/firebase/services/expenses";
import type { ExpensePrefill } from "@/firebase/services/expenses";
import type { ExpenseCategory, ExpenseDoc, WithId } from "@/firebase/interfaces";
import { compressOrPassPdf } from "@/utils/image";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  visible: boolean;
  jobId: string;
  clientId: string | null;
  // Fixed-price jobs: receipts are cost-tracking only — hide markup/billing.
  costTrackingOnly?: boolean;
  // Optional pre-fill for the manual path — e.g. a supplier the tradie just
  // shopped from. Applied when the dialog opens; they just enter the amount.
  prefill?: ExpensePrefill | null;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  added: [];
}>();

const { date, money } = useFormatters();
const toast = useToast();

const CATEGORY_OPTIONS = EXPENSE_CATEGORY_OPTIONS;

// ----- form state -----
const description = ref("");
const costDollars = ref<number | null>(null);
const markupPercent = ref<number>(DEFAULT_MARKUP_PERCENT);
const billedDollars = ref<number | null>(null);
// Once the tradie edits "client pays" directly, stop auto-recomputing it.
const billedTouched = ref(false);
const category = ref<ExpenseCategory | null>("materials");
const ocrVendor = ref<string | null>(null);
const ocrSpentAt = ref<Date | null>(null);
// Vendor carried in from a prefill (e.g. the supplier shopped from). Saved on
// the manual path so the expense row shows where it came from.
const prefillVendor = ref<string | null>(null);

// ----- receipt / OCR state -----
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const parsing = ref(false);
const receiptExpenseId = ref<string | null>(null);
const aiParsed = ref(false);
const saving = ref(false);
let expenseUnsub: (() => void) | null = null;
// Set while tearing down after cancel so a late OCR error doesn't toast.
let abandoned = false;

watch(
  () => props.visible,
  (v) => {
    if (v) {
      description.value = props.prefill?.description ?? "";
      costDollars.value = null;
      markupPercent.value = DEFAULT_MARKUP_PERCENT;
      billedDollars.value = null;
      billedTouched.value = false;
      category.value = props.prefill?.category ?? "materials";
      ocrVendor.value = null;
      ocrSpentAt.value = null;
      prefillVendor.value = props.prefill?.vendor ?? null;
      receiptExpenseId.value = null;
      uploading.value = false;
      parsing.value = false;
      aiParsed.value = false;
      saving.value = false;
      abandoned = false;
    } else {
      detach();
    }
  },
);

function detach() {
  expenseUnsub?.();
  expenseUnsub = null;
}

// Keep "client pays" in sync with cost × markup until the tradie overrides it.
watch([costDollars, markupPercent], () => {
  if (billedTouched.value) return;
  const cents = computeBilledAmount(
    Math.round((costDollars.value ?? 0) * 100),
    markupPercent.value ?? 0,
  );
  billedDollars.value = cents > 0 ? cents / 100 : null;
});

function pickFile() {
  fileInput.value?.click();
}

async function onFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  await handleUpload(file);
}

async function handleUpload(file: File) {
  if (uploading.value || receiptExpenseId.value) return;
  uploading.value = true;
  try {
    // Storage rules accept webp + pdf only. Compress images; pass PDFs through.
    const prepared = await compressOrPassPdf(file, { maxDimension: 1800, quality: 0.82 });
    const { expenseId } = await uploadReceiptAndCreateExpense(
      props.jobId,
      props.clientId,
      prepared,
    );
    receiptExpenseId.value = expenseId;
    parsing.value = true;
    // Watch the doc — parseReceipt writes the OCR'd fields onto it.
    expenseUnsub = subscribeExpense(props.jobId, expenseId, onExpenseSnapshot);
    parseReceiptCallable(props.jobId, expenseId).catch((e) => {
      parsing.value = false;
      if (!abandoned) toast.warn("Couldn't auto-read", humanizeError(e));
    });
  } catch (e) {
    toast.error("Upload failed", humanizeError(e));
  } finally {
    uploading.value = false;
  }
}

// OCR finished (or failed): pull the parsed fields into the form, but never
// stomp something the tradesperson already typed while waiting.
function onExpenseSnapshot(e: WithId<ExpenseDoc> | null) {
  if (!e || e.status === "parsing") return;
  parsing.value = false;
  aiParsed.value = e.aiParsed;
  if (!description.value.trim() && e.description) description.value = e.description;
  if ((costDollars.value ?? 0) <= 0 && (e.totalCost ?? 0) > 0) {
    costDollars.value = e.totalCost / 100;
  }
  if (e.category) category.value = e.category;
  ocrVendor.value = e.vendor ?? null;
  ocrSpentAt.value = e.spentAt ? e.spentAt.toDate() : null;
  detach();
}

const canSave = computed(() => {
  if (saving.value || uploading.value) return false;
  // A receipt-backed expense can be saved as-is (the row stays editable in the
  // card); a manual one needs at least a description or a cost to be worth a row.
  if (receiptExpenseId.value) return true;
  return description.value.trim().length > 0 || (costDollars.value ?? 0) > 0;
});

async function onSave() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const patch = {
      description: description.value.trim(),
      totalCost: Math.round((costDollars.value ?? 0) * 100),
      markupPercent: markupPercent.value ?? 0,
      billedAmount: Math.round((billedDollars.value ?? 0) * 100),
      category: category.value,
    };
    if (receiptExpenseId.value) {
      await updateExpense(props.jobId, receiptExpenseId.value, patch);
    } else {
      // Carry the vendor only on the manual path — the receipt path keeps the
      // OCR'd vendor untouched.
      await createManualExpense(props.jobId, props.clientId, {
        ...patch,
        vendor: prefillVendor.value,
      });
    }
    toast.success("Expense added", patch.description || "Saved to this job");
    emit("added");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't save expense", humanizeError(e));
  } finally {
    saving.value = false;
  }
}

// Cancel after an upload deletes the just-created doc — otherwise a ghost
// half-parsed row appears in the card.
async function onCancel() {
  if (saving.value || uploading.value) return;
  abandoned = true;
  detach();
  if (receiptExpenseId.value) {
    try {
      await deleteExpense(props.jobId, receiptExpenseId.value);
    } catch {
      /* best-effort — worst case the row shows up in the card for manual cleanup */
    }
  }
  emit("update:visible", false);
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :closable="!saving && !uploading"
    :draggable="false"
    header="Add expense"
    :style="{ width: '92vw', maxWidth: '420px' }"
    @update:visible="(v) => { if (!v) onCancel(); }"
  >
    <div class="space-y-4">
      <p class="text-xs leading-snug text-[color:var(--bs-muted)]">
        <template v-if="costTrackingOnly">
          For your records on this fixed-price job — receipts aren't billed to the client.
        </template>
        <template v-else>
          Upload the receipt and the fields fill themselves — or skip it and type them in.
          The client only sees the marked-up line item.
        </template>
      </p>

      <Message
        v-if="prefillVendor && !receiptExpenseId"
        severity="info"
        :closable="false"
        class="text-xs"
      >
        Logging a purchase from <strong>{{ prefillVendor }}</strong> — just enter what you paid.
      </Message>

      <!-- Receipt upload + AI auto-fill -->
      <input
        ref="fileInput"
        type="file"
        accept="image/*,application/pdf"
        class="hidden"
        @change="onFileChange"
      />
      <Button
        v-if="!receiptExpenseId"
        label="Upload receipt — auto-fill with AI"
        icon="pi pi-camera"
        outlined
        class="w-full"
        :loading="uploading"
        :disabled="uploading"
        @click="pickFile"
      />
      <Message v-else-if="parsing" severity="info" :closable="false" class="text-xs">
        <i class="pi pi-spin pi-spinner me-1"></i>
        Reading the receipt — fields fill in automatically in a few seconds. You
        can keep typing; we won't overwrite what you enter.
      </Message>
      <Message v-else severity="success" :closable="false" class="text-xs">
        <template v-if="aiParsed">
          Receipt read<template v-if="ocrVendor"> — {{ ocrVendor }}</template>
          <template v-if="ocrSpentAt"> · {{ date(ocrSpentAt) }}</template>.
          Give the fields a once-over and save.
        </template>
        <template v-else>
          Receipt attached, but it couldn't be auto-read — fill the fields in below.
        </template>
      </Message>

      <div>
        <label class="mb-1 block text-[11px] text-[color:var(--bs-muted)]" for="exp-desc">
          Description
        </label>
        <InputText
          id="exp-desc"
          v-model="description"
          maxlength="300"
          placeholder="e.g. Pipe + fittings"
          class="w-full"
        />
      </div>

      <div :class="costTrackingOnly ? '' : 'grid grid-cols-2 gap-2'">
        <div>
          <label class="mb-1 block text-[11px] text-[color:var(--bs-muted)]" for="exp-cost">
            You paid
          </label>
          <NumberField
            v-model="costDollars"
            input-id="exp-cost"
            mode="currency"
            currency="CAD"
            :min="0"
            :max-fraction-digits="2"
            class="w-full"
            fluid
          />
        </div>
        <div v-if="!costTrackingOnly">
          <label class="mb-1 block text-[11px] text-[color:var(--bs-muted)]" for="exp-markup">
            Markup %
          </label>
          <NumberField
            v-model="markupPercent"
            input-id="exp-markup"
            :min="0"
            :max="1000"
            :max-fraction-digits="1"
            suffix=" %"
            class="w-full"
            fluid
          />
        </div>
      </div>

      <div v-if="!costTrackingOnly">
        <label class="mb-1 block text-[11px] text-[color:var(--bs-muted)]" for="exp-billed">
          Client pays
        </label>
        <NumberField
          v-model="billedDollars"
          input-id="exp-billed"
          mode="currency"
          currency="CAD"
          :min="0"
          :max-fraction-digits="2"
          :input-class="'font-semibold'"
          class="w-full"
          fluid
          @input="billedTouched = true"
        />
        <p v-if="(billedDollars ?? 0) > 0" class="mt-1 text-[11px] text-[color:var(--bs-muted)]">
          {{ money(Math.round((billedDollars ?? 0) * 100)) }} rides onto the invoice as one line.
        </p>
      </div>

      <div>
        <label class="mb-1 block text-[11px] text-[color:var(--bs-muted)]">Category</label>
        <Select
          v-model="category"
          :options="CATEGORY_OPTIONS"
          option-label="label"
          option-value="value"
          placeholder="Category"
          class="w-full"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex w-full gap-2">
        <Button
          label="Cancel"
          text
          :disabled="saving || uploading"
          class="flex-1"
          @click="onCancel"
        />
        <Button
          label="Add expense"
          icon="pi pi-plus"
          :loading="saving"
          :disabled="!canSave"
          class="flex-1"
          @click="onSave"
        />
      </div>
    </template>
  </Dialog>
</template>
