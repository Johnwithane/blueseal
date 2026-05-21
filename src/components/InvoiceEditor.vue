<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Tag from "primevue/tag";
import { getInvoice, updateInvoiceLineItems, markInvoicePaid, recomputeTotals } from "@/firebase/services/invoices";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";
import type { InvoiceDoc, LineItem, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { lineItemSchema } from "@/validation/schemas";
import { z } from "zod";

const props = defineProps<{
  invoiceId: string;
  canEdit: boolean;
}>();

const invoice = ref<WithId<InvoiceDoc> | null>(null);
// UI rows: same shape as LineItem but `unitPrice` is in DOLLARS for InputNumber
// currency mode to render correctly. Converted to cents on save.
interface UiLineItem {
  description: string;
  quantity: number;
  unitPriceDollars: number;
  taxRate: number;
}
const items = ref<UiLineItem[]>([]);
const loading = ref(true);
const saving = ref(false);
const { money, date } = useFormatters();
const toast = useToast();

const cents = (dollars: number) => Math.round(dollars * 100);

const totals = computed(() =>
  recomputeTotals(
    items.value.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: cents(li.unitPriceDollars ?? 0),
      taxRate: li.taxRate,
    })),
  ),
);

async function load() {
  loading.value = true;
  invoice.value = await getInvoice(props.invoiceId);
  items.value = (invoice.value?.lineItems ?? []).map((li) => ({
    description: li.description,
    quantity: li.quantity,
    unitPriceDollars: (li.unitPrice ?? 0) / 100,
    taxRate: li.taxRate,
  }));
  loading.value = false;
}

onMounted(load);
watch(() => props.invoiceId, load);

function addItem() {
  items.value = [
    ...items.value,
    { description: "", quantity: 1, unitPriceDollars: 0, taxRate: 0 },
  ];
}

function removeItem(i: number) {
  items.value = items.value.filter((_, idx) => idx !== i);
}

function snapshotForSave(): LineItem[] {
  return items.value.map((li) => ({
    description: li.description.trim(),
    quantity: li.quantity,
    unitPrice: cents(li.unitPriceDollars ?? 0),
    taxRate: li.taxRate,
  }));
}

function validateLineItems(): LineItem[] | null {
  const next = snapshotForSave();
  const parsed = z.array(lineItemSchema).min(1, "Add at least one line item").safeParse(next);
  if (!parsed.success) {
    toast.error("Invoice invalid", parsed.error.issues[0]?.message ?? "Check the line items");
    return null;
  }
  return parsed.data;
}

async function save() {
  const next = validateLineItems();
  if (!next) return;
  saving.value = true;
  try {
    await updateInvoiceLineItems(props.invoiceId, next);
    toast.success("Invoice saved");
    await load();
  } catch (e) {
    toast.error("Save failed", humanizeError(e));
  } finally {
    saving.value = false;
  }
}

async function send() {
  const next = validateLineItems();
  if (!next) return;
  saving.value = true;
  try {
    // Persist the latest edits before sending so the PDF reflects them.
    await updateInvoiceLineItems(props.invoiceId, next);
    const fn = httpsCallable(functions, "sendInvoice");
    await fn({ invoiceId: props.invoiceId });
    toast.success("Invoice sent");
    await load();
  } catch (e) {
    toast.error("Send failed", humanizeError(e));
  } finally {
    saving.value = false;
  }
}

async function markPaid() {
  saving.value = true;
  try {
    await markInvoicePaid(props.invoiceId);
    toast.success("Marked paid");
    await load();
  } catch (e) {
    toast.error("Mark paid failed", humanizeError(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="bs-card p-4">
    <header class="flex items-center justify-between mb-2">
      <div>
        <h3 class="font-semibold">Invoice</h3>
        <div v-if="invoice" class="text-xs text-[color:var(--bs-muted)]">
          {{ invoice.invoiceNumber }} • Issued {{ date(invoice.issuedAt) }}
        </div>
      </div>
      <Tag v-if="invoice" :value="invoice.status" />
    </header>

    <div v-if="loading" class="bs-empty">Loading…</div>
    <template v-else-if="invoice">
      <table class="w-full text-sm border-t">
        <thead>
          <tr class="text-left text-[color:var(--bs-muted)]">
            <th class="py-1 font-medium">Description</th>
            <th class="py-1 font-medium w-20 text-right">Qty</th>
            <th class="py-1 font-medium w-32 text-right">Unit price</th>
            <th class="py-1 font-medium w-20 text-right">Tax %</th>
            <th class="py-1 font-medium w-28 text-right">Line</th>
            <th v-if="props.canEdit" class="w-8"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(li, i) in items" :key="i" class="border-t align-top">
            <td class="py-1.5">
              <InputText v-if="props.canEdit" v-model="li.description" maxlength="300" class="w-full" />
              <span v-else>{{ li.description }}</span>
            </td>
            <td class="py-1.5 text-right">
              <InputNumber v-if="props.canEdit" v-model="li.quantity" :min="0" :max-fraction-digits="2" :input-class="'text-right w-16'" />
              <span v-else>{{ li.quantity }}</span>
            </td>
            <td class="py-1.5 text-right">
              <InputNumber v-if="props.canEdit" v-model="li.unitPriceDollars" :min="0" mode="currency" currency="CAD" :input-class="'text-right w-28'" />
              <span v-else>{{ money(cents(li.unitPriceDollars)) }}</span>
            </td>
            <td class="py-1.5 text-right">
              <InputNumber v-if="props.canEdit" v-model="li.taxRate" :min="0" :max="0.5" :max-fraction-digits="3" :input-class="'text-right w-16'" />
              <span v-else>{{ (li.taxRate * 100).toFixed(1) }}%</span>
            </td>
            <td class="py-1.5 text-right">{{ money(cents(li.quantity * li.unitPriceDollars)) }}</td>
            <td v-if="props.canEdit" class="py-1.5 text-right">
              <Button text icon="pi pi-times" size="small" severity="danger" aria-label="Remove line" @click="removeItem(i)" />
            </td>
          </tr>
        </tbody>
        <tfoot class="border-t">
          <tr>
            <td colspan="4" class="py-1 text-right text-[color:var(--bs-muted)]">Subtotal</td>
            <td class="py-1 text-right">{{ money(totals.subtotal) }}</td>
            <td v-if="props.canEdit"></td>
          </tr>
          <tr>
            <td colspan="4" class="py-1 text-right text-[color:var(--bs-muted)]">Tax</td>
            <td class="py-1 text-right">{{ money(totals.taxTotal) }}</td>
            <td v-if="props.canEdit"></td>
          </tr>
          <tr>
            <td colspan="4" class="py-1 text-right font-semibold">Total</td>
            <td class="py-1 text-right font-bold">{{ money(totals.total) }}</td>
            <td v-if="props.canEdit"></td>
          </tr>
        </tfoot>
      </table>

      <div v-if="props.canEdit" class="flex flex-wrap items-center gap-2 mt-3">
        <Button label="Add line" icon="pi pi-plus" outlined size="small" @click="addItem" />
        <span class="flex-1"></span>
        <Button label="Save" icon="pi pi-save" outlined :loading="saving" :disabled="saving" @click="save" />
        <Button
          v-if="invoice.status === 'draft'"
          label="Send"
          icon="pi pi-send"
          :loading="saving"
          :disabled="saving"
          @click="send"
        />
        <Button
          v-if="invoice.status === 'sent' || invoice.status === 'viewed' || invoice.status === 'overdue'"
          label="Mark paid"
          icon="pi pi-check"
          severity="success"
          :loading="saving"
          :disabled="saving"
          @click="markPaid"
        />
        <a v-if="invoice.pdfUrl" :href="invoice.pdfUrl" target="_blank" rel="noopener noreferrer">
          <Button label="Download PDF" icon="pi pi-download" outlined size="small" />
        </a>
      </div>
    </template>
  </div>
</template>
