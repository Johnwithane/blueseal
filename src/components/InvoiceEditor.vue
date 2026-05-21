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

const props = defineProps<{
  invoiceId: string;
  canEdit: boolean;
}>();

const invoice = ref<WithId<InvoiceDoc> | null>(null);
const items = ref<LineItem[]>([]);
const loading = ref(true);
const saving = ref(false);
const { money, date } = useFormatters();
const toast = useToast();

const totals = computed(() => recomputeTotals(items.value));

async function load() {
  loading.value = true;
  invoice.value = await getInvoice(props.invoiceId);
  items.value = invoice.value?.lineItems ?? [];
  loading.value = false;
}

onMounted(load);
watch(() => props.invoiceId, load);

function addItem() {
  items.value = [...items.value, { description: "", quantity: 1, unitPrice: 0, taxRate: 0 }];
}

function removeItem(i: number) {
  items.value = items.value.filter((_, idx) => idx !== i);
}

async function save() {
  saving.value = true;
  try {
    await updateInvoiceLineItems(props.invoiceId, items.value);
    toast.success("Invoice saved");
    await load();
  } finally {
    saving.value = false;
  }
}

async function send() {
  saving.value = true;
  try {
    const fn = httpsCallable(functions, "sendInvoice");
    await fn({ invoiceId: props.invoiceId });
    toast.success("Invoice sent");
    await load();
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
              <InputText v-if="props.canEdit" v-model="li.description" class="w-full" />
              <span v-else>{{ li.description }}</span>
            </td>
            <td class="py-1.5 text-right">
              <InputNumber v-if="props.canEdit" v-model="li.quantity" :min="0" :max-fraction-digits="2" :input-class="'text-right w-16'" />
              <span v-else>{{ li.quantity }}</span>
            </td>
            <td class="py-1.5 text-right">
              <InputNumber v-if="props.canEdit" v-model="li.unitPrice" :min="0" mode="currency" currency="CAD" :input-class="'text-right w-28'" />
              <span v-else>{{ money(li.unitPrice) }}</span>
            </td>
            <td class="py-1.5 text-right">
              <InputNumber v-if="props.canEdit" v-model="li.taxRate" :min="0" :max="1" :max-fraction-digits="3" :input-class="'text-right w-16'" />
              <span v-else>{{ (li.taxRate * 100).toFixed(1) }}%</span>
            </td>
            <td class="py-1.5 text-right">{{ money(li.quantity * li.unitPrice) }}</td>
            <td v-if="props.canEdit" class="py-1.5 text-right">
              <Button text icon="pi pi-times" size="small" severity="danger" @click="removeItem(i)" />
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
        <Button label="Save" icon="pi pi-save" outlined :loading="saving" @click="save" />
        <Button
          v-if="invoice.status === 'draft'"
          label="Send"
          icon="pi pi-send"
          :loading="saving"
          @click="send"
        />
        <Button
          v-if="invoice.status === 'sent' || invoice.status === 'viewed' || invoice.status === 'overdue'"
          label="Mark paid"
          icon="pi pi-check"
          severity="success"
          :loading="saving"
          @click="markPaid"
        />
        <a v-if="invoice.pdfUrl" :href="invoice.pdfUrl" target="_blank" rel="noopener">
          <Button label="Download PDF" icon="pi pi-download" outlined size="small" />
        </a>
      </div>
    </template>
  </div>
</template>
