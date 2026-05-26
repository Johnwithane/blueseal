<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Tag from "primevue/tag";
import {
  getInvoice,
  updateInvoiceLineItems,
  updateInvoiceDiscount,
  markInvoicePaid,
  pullBillablesFromJob,
  recomputeTotals,
} from "@/firebase/services/invoices";
import { getInvoicePartyInfo } from "@/firebase/services/jobs";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { subscribePayoutsState } from "@/firebase/services/payoutsService";
import PdfPreviewDialog from "@/components/PdfPreviewDialog.vue";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";
import type {
  InvoiceDiscount,
  InvoiceDoc,
  LineItem,
  PayoutsState,
  WithId,
} from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import SelectButton from "primevue/selectbutton";
import { lineItemSchema } from "@/validation/schemas";
import { z } from "zod";

const props = defineProps<{
  invoiceId: string;
  canEdit: boolean;
  /** Names denormalized on the job — used for the PDF "From"/"To" header. */
  tradespersonName?: string | null;
  clientName?: string | null;
  /** When true, start collapsed (header-only). User can toggle open. */
  defaultCollapsed?: boolean;
}>();

const renderingPdf = ref(false);
const pdfBlob = ref<Blob | null>(null);
const pdfFilename = ref("");
const showPdfPreview = ref(false);

// Collapsible state. Initialised from defaultCollapsed; user can toggle.
const collapsed = ref(false);
watch(
  () => props.defaultCollapsed,
  (v) => {
    collapsed.value = !!v;
  },
  { immediate: true },
);

async function openPdfPreview() {
  if (!invoice.value || renderingPdf.value) return;
  renderingPdf.value = true;
  try {
    const [{ renderInvoicePdfBlob }, party] = await Promise.all([
      import("@/utils/pdfRender"),
      getInvoicePartyInfo(invoice.value.jobId),
    ]);
    const { blob, filename } = await renderInvoicePdfBlob(invoice.value, party);
    pdfBlob.value = blob;
    pdfFilename.value = filename;
    showPdfPreview.value = true;
  } catch (e) {
    toast.error("Couldn't render PDF", humanizeError(e));
  } finally {
    renderingPdf.value = false;
  }
}

const invoice = ref<WithId<InvoiceDoc> | null>(null);
// Tradesperson's company logo + name, surfaced at the top of the editor
// card so the in-app invoice view matches what the client will see on the
// PDF. Pulled fresh from /tradespeople/{uid} each load so logo updates
// propagate immediately. Null when the tradesperson hasn't uploaded one.
const tradieLogoUrl = ref<string | null>(null);
const tradieCompanyName = ref<string | null>(null);
// UI rows: same shape as LineItem but `unitPrice` is in DOLLARS for InputNumber
// currency mode to render correctly. Converted to cents on save. `id` is
// preserved end-to-end so pulled-in entries/expenses don't get re-pulled
// on the next pull-billables click.
interface UiLineItem {
  id?: string;
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

// Discount UI state — mirrors FinishJobSheet's shape but operates against
// an existing invoice rather than a pre-submit preview. Edits persist via
// updateInvoiceDiscount so totals recompute server-side too.
type DiscountMode = "off" | "percent" | "fixed";
const discountMode = ref<DiscountMode>("off");
const discountValueDisplay = ref<number>(0); // percent number, or dollars for fixed
const discountLabel = ref<string>("");
const discountModeOptions = [
  { label: "No discount", value: "off" },
  { label: "Percent %", value: "percent" },
  { label: "Fixed $", value: "fixed" },
];

function discountSnapshot(): InvoiceDiscount | null {
  if (discountMode.value === "off") return null;
  const label = discountLabel.value.trim() || null;
  if (discountMode.value === "percent") {
    return {
      type: "percent",
      value: Math.max(0, Math.min(100, discountValueDisplay.value ?? 0)),
      label,
    };
  }
  return {
    type: "fixed",
    value: Math.max(0, cents(discountValueDisplay.value ?? 0)),
    label,
  };
}

const totals = computed(() =>
  recomputeTotals(
    items.value.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: cents(li.unitPriceDollars ?? 0),
      taxRate: li.taxRate,
    })),
    discountSnapshot(),
  ),
);

async function load() {
  loading.value = true;
  invoice.value = await getInvoice(props.invoiceId);
  // Lookup the tradesperson's branding (logo + company name) for the
  // header row. Best-effort — the editor still works for a viewer who
  // can't read the tradie doc (the public tradesperson collection is
  // readable when the doc is visible, otherwise the call no-ops).
  if (invoice.value) {
    try {
      const t = await getTradesperson(invoice.value.tradespersonId);
      tradieLogoUrl.value = t?.companyLogoUrl ?? null;
      tradieCompanyName.value = t?.companyName ?? null;
    } catch {
      tradieLogoUrl.value = null;
      tradieCompanyName.value = null;
    }
  }
  items.value = (invoice.value?.lineItems ?? []).map((li) => ({
    id: li.id,
    description: li.description,
    quantity: li.quantity,
    unitPriceDollars: (li.unitPrice ?? 0) / 100,
    taxRate: li.taxRate,
  }));
  const d = invoice.value?.discount ?? null;
  if (d) {
    discountMode.value = d.type;
    discountValueDisplay.value = d.type === "fixed" ? (d.value ?? 0) / 100 : d.value ?? 0;
    discountLabel.value = d.label ?? "";
  } else {
    discountMode.value = "off";
    discountValueDisplay.value = 0;
    discountLabel.value = "";
  }
  loading.value = false;
}

onMounted(load);
watch(() => props.invoiceId, load);

// Payouts pre-flight. sendInvoice will reject server-side if
// payouts aren't enabled (Connect onboarding incomplete or the
// account got restricted), so the Send button is a dead-end until
// the tradesperson opens /payouts and finishes. Live-subscribe to
// the tradie's payouts state so the button reflects current status
// in real time (e.g. `account.updated` flipping enabled → restricted
// while the editor is open). Only subscribe when the editor is in
// edit mode (canEdit true means the viewer is the tradesperson on
// their own invoice — the client never gets a Send button anyway).
const payoutsState = ref<PayoutsState | null>(null);
const payoutsLoaded = ref(false);
let unsubPayouts: (() => void) | null = null;

watch(
  () => [props.canEdit, invoice.value?.tradespersonId] as const,
  ([canEdit, tradieId]) => {
    unsubPayouts?.();
    unsubPayouts = null;
    payoutsLoaded.value = false;
    if (!canEdit || !tradieId) {
      payoutsState.value = null;
      payoutsLoaded.value = true;
      return;
    }
    unsubPayouts = subscribePayoutsState(tradieId, (s) => {
      payoutsState.value = s;
      payoutsLoaded.value = true;
    });
  },
  { immediate: true },
);

onBeforeUnmount(() => unsubPayouts?.());

const payoutsReady = computed(() => {
  if (!payoutsLoaded.value) return true; // optimistic: don't flash a warning
  const s = payoutsState.value;
  if (!s) return false;
  return s.payoutsEnabled && s.onboardingStatus === "enabled";
});

const payoutsBlockerMessage = computed(() => {
  if (payoutsReady.value) return null;
  const s = payoutsState.value;
  if (!s || s.onboardingStatus === "not_started") {
    return "Set up Stripe payouts before sending invoices.";
  }
  if (s.onboardingStatus === "in_progress") {
    return "Finish your Stripe onboarding to start sending invoices.";
  }
  if (s.onboardingStatus === "restricted") {
    return "Stripe needs more info on your account before you can collect payments.";
  }
  return "Payouts aren't ready yet — open /payouts to check.";
});

function addItem() {
  items.value = [
    ...items.value,
    { id: undefined, description: "", quantity: 1, unitPriceDollars: 0, taxRate: 0 },
  ];
}

async function pullBillables() {
  if (saving.value) return;
  saving.value = true;
  try {
    const res = await pullBillablesFromJob(props.invoiceId);
    if (res.added === 0) {
      toast.info("Nothing to pull", "No new time entries or expenses since the last pull.");
    } else {
      toast.success(
        "Pulled into invoice",
        `${res.added} new line${res.added === 1 ? "" : "s"} added.`,
      );
    }
    await load();
  } catch (e) {
    toast.error("Couldn't pull billables", humanizeError(e));
  } finally {
    saving.value = false;
  }
}

function removeItem(i: number) {
  items.value = items.value.filter((_, idx) => idx !== i);
}

function snapshotForSave(): LineItem[] {
  return items.value.map((li) => ({
    ...(li.id ? { id: li.id } : {}),
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
    // Order matters: line items first (updateInvoiceLineItems re-reads the
    // live discount so it doesn't accidentally clear it), then discount.
    // Both writes recompute totals server-side.
    await updateInvoiceLineItems(props.invoiceId, next);
    await updateInvoiceDiscount(props.invoiceId, discountSnapshot());
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
    <!-- Header doubles as the collapse toggle so a tap anywhere on it
         opens/closes the invoice body. Tag stays visible while
         collapsed so the user sees status at a glance. -->
    <button
      type="button"
      class="flex items-center justify-between w-full text-left"
      :class="{ 'mb-2': !collapsed }"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <div class="flex items-center gap-2 min-w-0">
        <i
          class="pi text-xs text-[color:var(--bs-muted)] shrink-0"
          :class="collapsed ? 'pi-chevron-right' : 'pi-chevron-down'"
          aria-hidden="true"
        ></i>
        <div class="min-w-0">
          <h3 class="font-semibold">Invoice</h3>
          <div v-if="invoice" class="text-xs text-[color:var(--bs-muted)] truncate">
            {{ invoice.invoiceNumber }} • Issued {{ date(invoice.issuedAt) }}
          </div>
        </div>
      </div>
      <Tag v-if="invoice" :value="invoice.status" />
    </button>

    <template v-if="!collapsed">
    <div v-if="loading" class="bs-empty">Loading…</div>
    <template v-else-if="invoice">
      <!-- Company branding row — mirrors what the client sees on the
           generated PDF. Only renders when the tradesperson has a logo
           or company name set; otherwise we skip the row so the editor
           looks identical to its pre-branding shape. -->
      <div
        v-if="tradieLogoUrl || tradieCompanyName"
        class="flex items-center gap-3 pb-3 mb-2 border-b"
      >
        <img
          v-if="tradieLogoUrl"
          :src="tradieLogoUrl"
          alt="Company logo"
          class="h-10 w-10 rounded object-contain bg-white"
        />
        <div v-if="tradieCompanyName" class="text-sm font-semibold">
          {{ tradieCompanyName }}
        </div>
      </div>
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
            <!-- Line total includes tax (qty × unit × (1 + taxRate)) so
                 the column reflects the per-line "Tax %" without the
                 client having to do mental math. The bottom totals card
                 still shows the pre-tax subtotal + tax breakdown. -->
            <td class="py-1.5 text-right">{{ money(Math.round(cents(li.quantity * li.unitPriceDollars) * (1 + (li.taxRate ?? 0)))) }}</td>
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
          <tr v-if="totals.discountAmount > 0" class="text-[color:var(--bs-blue)]">
            <td colspan="4" class="py-1 text-right">
              Discount
              <span v-if="discountLabel.trim()" class="text-xs text-[color:var(--bs-muted)]">
                ({{ discountLabel.trim() }})
              </span>
            </td>
            <td class="py-1 text-right">−{{ money(totals.discountAmount) }}</td>
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

      <div v-if="props.canEdit" class="mt-3 rounded-lg border border-[color:var(--bs-border)] p-3">
        <div class="flex items-center gap-2 mb-2">
          <i class="pi pi-percentage text-[color:var(--bs-blue)]"></i>
          <h4 class="font-semibold text-sm">Discount</h4>
        </div>
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
              v-model="discountValueDisplay"
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
        <p class="text-[11px] text-[color:var(--bs-muted)] mt-2">
          Applied to the subtotal before tax. Save the invoice to persist the change.
        </p>
      </div>

      <!-- Pre-flight blocker: shown in place of a confusing post-click
           server-side rejection. Without this the Send button errors
           with "Finish Stripe Connect onboarding at /payouts" only
           after the click, and the tradesperson has to navigate away
           to fix it. -->
      <div
        v-if="props.canEdit && invoice.status === 'draft' && payoutsLoaded && !payoutsReady"
        class="bs-card p-3 mt-3 border-l-4 border-l-amber-500"
      >
        <div class="flex items-start gap-2">
          <i class="pi pi-exclamation-triangle text-amber-600 mt-0.5"></i>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{{ payoutsBlockerMessage }}</p>
            <RouterLink to="/payouts" class="text-xs text-[color:var(--bs-blue-dark)] underline">
              Open payouts setup →
            </RouterLink>
          </div>
        </div>
      </div>

      <div v-if="props.canEdit" class="flex flex-wrap items-center gap-2 mt-3">
        <Button label="Add line" icon="pi pi-plus" outlined size="small" @click="addItem" />
        <Button
          v-if="invoice && invoice.status !== 'paid' && invoice.status !== 'void'"
          label="Pull from job"
          icon="pi pi-download"
          outlined
          size="small"
          :loading="saving"
          :disabled="saving"
          @click="pullBillables"
        />
        <span class="flex-1"></span>
        <Button label="Save" icon="pi pi-save" outlined :loading="saving" :disabled="saving" @click="save" />
        <Button
          v-if="invoice.status === 'draft'"
          label="Send"
          icon="pi pi-send"
          :loading="saving"
          :disabled="saving || !payoutsReady"
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
      </div>

      <!-- View / download row: visible to both tradesperson and client.
           Opens the PDF in an in-app preview modal with download +
           open-in-new-tab from the modal footer. -->
      <div class="flex items-center mt-3">
        <Button
          label="View PDF"
          icon="pi pi-file-pdf"
          outlined
          size="small"
          :loading="renderingPdf"
          :disabled="renderingPdf"
          @click="openPdfPreview"
        />
      </div>
    </template>
    </template>

    <PdfPreviewDialog
      v-model:visible="showPdfPreview"
      :blob="pdfBlob"
      :filename="pdfFilename"
      :title="invoice ? `Invoice ${invoice.invoiceNumber}` : ''"
    />
  </div>
</template>
