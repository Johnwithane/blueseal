<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import NumberField from "@/components/NumberField.vue";
import Select from "primevue/select";
import Tag from "primevue/tag";
import Message from "primevue/message";
import {
  DEFAULT_MARKUP_PERCENT,
  EXPENSE_CATEGORY_OPTIONS,
  computeBilledAmount,
  deleteExpense,
  getReceiptDownloadUrl,
  subscribeJobExpenses,
  updateExpense,
  type ExpensePrefill,
} from "@/firebase/services/expenses";
import type { ExpenseCategory, ExpenseDoc, WithId } from "@/firebase/interfaces";
import AddExpenseDialog from "@/components/AddExpenseDialog.vue";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { useConfirmAction } from "@/composables/useConfirmAction";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  jobId: string;
  clientId: string | null;
  tradespersonId: string;
  // On a fixed-price job receipts are cost-tracking only — they never bill the
  // client (the agreed price covers materials), so the markup / "client pays"
  // controls are hidden and the copy reframes them as private records.
  // Defaults to hourly behaviour when omitted.
  billingType?: "hourly" | "fixed";
}>();

const costTrackingOnly = computed(() => props.billingType === "fixed");

const { date, money } = useFormatters();
const toast = useToast();
const { confirmDestructive } = useConfirmAction();

const expenses = ref<WithId<ExpenseDoc>[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
// "Add expense" popup — receipt upload + AI auto-fill, or manual entry.
const showAddDialog = ref(false);
// Set when a sibling (the Supplies panel) opens the dialog pre-filled after a
// supplier click-through; cleared for a plain "Add expense" tap.
const pendingPrefill = ref<ExpensePrefill | null>(null);

/** Open the add-expense dialog, optionally pre-filled. Exposed to the parent. */
function openAdd(prefill?: ExpensePrefill | null) {
  pendingPrefill.value = prefill ?? null;
  showAddDialog.value = true;
}
defineExpose({ openAdd });

const CATEGORY_OPTIONS = EXPENSE_CATEGORY_OPTIONS;

const totalCost = computed(() => expenses.value.reduce((acc, e) => acc + (e.totalCost ?? 0), 0));
const totalBilled = computed(() =>
  expenses.value.reduce((acc, e) => acc + (e.billedAmount ?? 0), 0),
);

let unsubscribe: (() => void) | null = null;
function attach() {
  unsubscribe?.();
  loading.value = true;
  loadError.value = null;
  unsubscribe = subscribeJobExpenses(
    props.jobId,
    props.tradespersonId,
    (list) => {
      expenses.value = list;
      loadError.value = null;
      loading.value = false;
    },
    (err) => {
      // One denied doc tanks the whole snapshot. Surface it instead of
      // leaving the card stuck on "Loading…".
      expenses.value = [];
      loading.value = false;
      loadError.value = humanizeError(err);
    },
  );
}
onMounted(attach);
onBeforeUnmount(() => unsubscribe?.());
watch(() => props.jobId, attach);

async function patchField(
  entry: WithId<ExpenseDoc>,
  patch: Parameters<typeof updateExpense>[2],
) {
  try {
    await updateExpense(props.jobId, entry.id, patch);
  } catch (e) {
    toast.error("Couldn't save", humanizeError(e));
  }
}

async function changeTotalCost(entry: WithId<ExpenseDoc>, dollars: number | null) {
  const cents = Math.max(0, Math.round((dollars ?? 0) * 100));
  const billed = computeBilledAmount(cents, entry.markupPercent ?? DEFAULT_MARKUP_PERCENT);
  await patchField(entry, { totalCost: cents, billedAmount: billed });
}

async function changeMarkup(entry: WithId<ExpenseDoc>, pct: number | null) {
  const next = Math.max(0, Math.min(1000, pct ?? 0));
  const billed = computeBilledAmount(entry.totalCost ?? 0, next);
  await patchField(entry, { markupPercent: next, billedAmount: billed });
}

async function changeBilled(entry: WithId<ExpenseDoc>, dollars: number | null) {
  const cents = Math.max(0, Math.round((dollars ?? 0) * 100));
  await patchField(entry, { billedAmount: cents });
}

function remove(entry: WithId<ExpenseDoc>) {
  confirmDestructive(
    {
      message: entry.receiptStoragePath
        ? "Delete this expense and its receipt?"
        : "Delete this expense?",
      header: "Delete expense",
      acceptLabel: "Delete",
    },
    async () => {
      try {
        await deleteExpense(props.jobId, entry.id);
        toast.success("Expense deleted");
      } catch (e) {
        toast.error("Couldn't delete", humanizeError(e));
      }
    },
  );
}

async function viewReceipt(entry: WithId<ExpenseDoc>) {
  if (!entry.receiptStoragePath) return;
  try {
    const url = await getReceiptDownloadUrl(entry.receiptStoragePath);
    window.open(url, "_blank", "noopener");
  } catch (e) {
    toast.error("Couldn't open receipt", humanizeError(e));
  }
}

function statusTagSeverity(s: ExpenseDoc["status"]): "info" | "warn" | "success" | "secondary" {
  if (s === "parsing") return "warn";
  if (s === "invoiced") return "secondary";
  return "info";
}
</script>

<template>
  <div class="bs-card p-3">
    <header class="flex items-start justify-between gap-2 mb-2">
      <div class="min-w-0 flex-1">
        <h3 class="font-semibold text-sm">Expenses</h3>
        <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
          <template v-if="expenses.length">
            Paid {{ money(totalCost) }}<template v-if="!costTrackingOnly"> • Billing {{ money(totalBilled) }}</template>
          </template>
          <template v-else-if="costTrackingOnly">
            Receipts for your records — not billed on a fixed-price job
          </template>
          <template v-else>Upload receipts or add materials to bill them through with markup</template>
        </div>
      </div>
    </header>

    <Button
      label="Add expense"
      icon="pi pi-plus"
      class="w-full"
      @click="openAdd()"
    />
    <p class="text-[11px] text-[color:var(--bs-muted)] mt-1.5 leading-snug">
      Upload a receipt and it's auto-read for total, vendor and date — or add a
      material you supplied yourself, no receipt needed.
      <template v-if="costTrackingOnly">
        On a fixed-price job these stay on your records — to charge an out-of-scope
        material, add a change order above.
      </template>
      <template v-else>
        Receipts stay private; the client only sees the marked-up line item.
      </template>
    </p>

    <div v-if="loading" class="bs-empty mt-3">Loading…</div>
    <Message
      v-else-if="expenses.length === 0"
      severity="info"
      :closable="false"
      class="mt-3"
    >
      No expenses logged yet.
    </Message>

    <ul v-else class="mt-3 space-y-3">
      <li
        v-for="e in expenses"
        :key="e.id"
        class="rounded-lg border border-[color:var(--bs-border)] p-3"
      >
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="min-w-0 flex-1">
            <div class="text-xs text-[color:var(--bs-muted)]">
              <template v-if="e.vendor">{{ e.vendor }}</template>
              <template v-else-if="e.receiptStoragePath === null">Added manually</template>
              <template v-else>Unknown vendor</template>
              <template v-if="e.spentAt"> • {{ date(e.spentAt) }}</template>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <Tag :value="e.status" :severity="statusTagSeverity(e.status)" />
            <Tag v-if="e.invoicedAt" value="Invoiced" severity="secondary" />
          </div>
        </div>

        <label class="block text-[11px] text-[color:var(--bs-muted)]">Description</label>
        <InputText
          :model-value="e.description"
          placeholder="e.g. Pipe + fittings"
          maxlength="300"
          class="w-full text-sm"
          @blur="(ev) => patchField(e, { description: (ev.target as HTMLInputElement).value })"
        />

        <div class="mt-2" :class="costTrackingOnly ? '' : 'grid grid-cols-2 gap-2'">
          <div>
            <label class="block text-[11px] text-[color:var(--bs-muted)]">You paid</label>
            <NumberField
              :model-value="(e.totalCost ?? 0) / 100"
              mode="currency"
              currency="CAD"
              :min="0"
              :max-fraction-digits="2"
              :input-class="'text-sm w-full'"
              fluid
              @update:model-value="(v) => changeTotalCost(e, v as number | null)"
            />
          </div>
          <div v-if="!costTrackingOnly">
            <label class="block text-[11px] text-[color:var(--bs-muted)]">Markup %</label>
            <NumberField
              :model-value="e.markupPercent ?? DEFAULT_MARKUP_PERCENT"
              :min="0"
              :max="1000"
              :max-fraction-digits="1"
              suffix=" %"
              :input-class="'text-sm w-full'"
              fluid
              @update:model-value="(v) => changeMarkup(e, v as number | null)"
            />
          </div>
        </div>
        <div v-if="!costTrackingOnly" class="mt-2">
          <label class="block text-[11px] text-[color:var(--bs-muted)]">Client pays</label>
          <NumberField
            :model-value="(e.billedAmount ?? 0) / 100"
            mode="currency"
            currency="CAD"
            :min="0"
            :max-fraction-digits="2"
            :input-class="'text-sm w-full font-semibold'"
            fluid
            @update:model-value="(v) => changeBilled(e, v as number | null)"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2 mt-2">
          <Select
            :model-value="e.category"
            :options="CATEGORY_OPTIONS"
            option-label="label"
            option-value="value"
            placeholder="Category"
            class="text-sm flex-1 min-w-[8rem]"
            @update:model-value="(v) => patchField(e, { category: v as ExpenseCategory | null })"
          />
          <Button
            v-if="e.receiptStoragePath"
            label="Receipt"
            icon="pi pi-external-link"
            text
            size="small"
            @click="viewReceipt(e)"
          />
          <Button
            v-if="!e.invoicedAt"
            text
            icon="pi pi-times"
            size="small"
            severity="danger"
            aria-label="Delete expense"
            @click="remove(e)"
          />
        </div>
      </li>
    </ul>

    <AddExpenseDialog
      v-model:visible="showAddDialog"
      :job-id="jobId"
      :client-id="clientId"
      :cost-tracking-only="costTrackingOnly"
      :prefill="pendingPrefill"
    />
  </div>
</template>
