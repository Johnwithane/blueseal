<script setup lang="ts">
// Client-facing invoice section — the invoice twin of QuoteCard, mounted at
// the TOP of the Invoice tab. Renders the invoice in the same format as the
// quote (InvoiceBreakdown) and owns every client action on it:
//   • awaiting_client_approval → Approve & pay / Request changes (the
//     review actions that used to live only in the page-top banner)
//   • awaiting_payment → Pay invoice (Stripe card view when payable,
//     offline mark-as-paid dialog otherwise)
//   • complete / reviewed → View receipt (Stripe payments)
// View PDF is always available.
import { onBeforeUnmount, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
import { subscribeInvoice } from "@/firebase/services/invoices";
import { clientApproveJob, clientRequestChanges, getInvoicePartyInfo } from "@/firebase/services/jobs";
import type { InvoiceDoc, InvoiceStatus, JobDoc, WithId } from "@/firebase/interfaces";
import InvoiceBreakdown from "@/components/InvoiceBreakdown.vue";
import PayInvoiceDialog from "@/components/PayInvoiceDialog.vue";
import PdfPreviewDialog from "@/components/PdfPreviewDialog.vue";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  job: WithId<JobDoc>;
  invoiceId: string;
  invoicePayable: boolean;
}>();

const emit = defineEmits<{
  /** Approve / request-changes landed — parent should reload the job. */
  decided: [];
  paid: [];
}>();

const { date } = useFormatters();
const toast = useToast();

const invoice = ref<WithId<InvoiceDoc> | null>(null);
let unsub: (() => void) | null = null;
watch(
  () => props.invoiceId,
  (id) => {
    unsub?.();
    invoice.value = null;
    unsub = subscribeInvoice(id, (inv) => (invoice.value = inv));
  },
  { immediate: true },
);
onBeforeUnmount(() => unsub?.());

const collapsed = ref(false);

// Client-friendly status labels — raw invoice statuses lean accounting-speak.
const STATUS_LABEL: Partial<Record<InvoiceStatus, string>> = {
  draft: "For your review",
  sent: "Awaiting payment",
  viewed: "Awaiting payment",
  processing: "Processing",
  paid: "Paid",
  overdue: "Overdue",
};
const STATUS_SEVERITY: Partial<
  Record<InvoiceStatus, "info" | "warn" | "success" | "danger" | "secondary">
> = {
  draft: "warn",
  sent: "info",
  viewed: "info",
  processing: "info",
  paid: "success",
  overdue: "danger",
};

// ---- approve / request changes (awaiting_client_approval) ----
const approving = ref(false);
const requesting = ref(false);
const showRequestDialog = ref(false);
const requestReason = ref("");

async function onApprove() {
  if (approving.value) return;
  approving.value = true;
  try {
    await clientApproveJob(props.job.id);
    toast.success("Approved", "The invoice is on its way — pay it right here when it lands.");
    emit("decided");
  } catch (e) {
    toast.error("Couldn't approve", humanizeError(e));
  } finally {
    approving.value = false;
  }
}

function openRequestDialog() {
  requestReason.value = "";
  showRequestDialog.value = true;
}

async function onSubmitRequest() {
  const text = requestReason.value.trim();
  if (!text) {
    toast.error("Please add a short note so the tradesperson knows what to change.");
    return;
  }
  if (requesting.value) return;
  requesting.value = true;
  try {
    await clientRequestChanges(props.job.id, text);
    toast.success("Sent back to the tradesperson", "They'll see your note in chat.");
    showRequestDialog.value = false;
    emit("decided");
  } catch (e) {
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    requesting.value = false;
  }
}

// ---- pay (awaiting_payment) ----
const showPayDialog = ref(false);

// ---- PDF ----
const renderingPdf = ref(false);
const pdfBlob = ref<Blob | null>(null);
const pdfFilename = ref("");
const showPdfPreview = ref(false);

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
</script>

<template>
  <div v-if="invoice" class="bs-card p-4">
    <!-- Header doubles as the collapse toggle — same affordance as the quote. -->
    <button
      type="button"
      class="flex items-center justify-between w-full text-left"
      :class="{ 'mb-3': !collapsed }"
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
          <div class="text-xs text-[color:var(--bs-muted)] truncate">
            {{ invoice.invoiceNumber }}
            <template v-if="invoice.issuedAt"> • Issued {{ date(invoice.issuedAt) }}</template>
          </div>
        </div>
      </div>
      <Tag
        :value="STATUS_LABEL[invoice.status] ?? invoice.status"
        :severity="STATUS_SEVERITY[invoice.status] ?? 'secondary'"
      />
    </button>

    <template v-if="!collapsed">
      <InvoiceBreakdown :invoice="invoice" />

      <!-- Review actions: the work is done, the invoice needs a yes/no. -->
      <div
        v-if="job.status === 'awaiting_client_approval'"
        class="mt-4 rounded-lg border border-[color:var(--bs-border)] p-3"
      >
        <p class="text-sm text-[color:var(--bs-muted)] mb-3">
          Your tradesperson marked the work as done. Approve this invoice to pay
          it, or request changes if anything's off.
        </p>
        <div class="grid sm:grid-cols-2 gap-2">
          <Button
            label="Request changes"
            icon="pi pi-undo"
            severity="secondary"
            outlined
            :disabled="approving || requesting"
            @click="openRequestDialog"
          />
          <Button
            label="Approve & pay"
            icon="pi pi-check"
            severity="success"
            :loading="approving"
            :disabled="approving || requesting"
            @click="onApprove"
          />
        </div>
      </div>

      <!-- Payment due. -->
      <div v-else-if="job.status === 'awaiting_payment'" class="mt-4">
        <RouterLink v-if="invoicePayable" :to="`/invoices/${invoiceId}/pay`" class="block">
          <Button label="Pay invoice" icon="pi pi-credit-card" severity="success" class="w-full" />
        </RouterLink>
        <Button
          v-else
          label="Pay invoice"
          icon="pi pi-wallet"
          severity="success"
          class="w-full"
          @click="showPayDialog = true"
        />
        <p class="text-xs text-[color:var(--bs-muted)] mt-2">
          <template v-if="invoicePayable">
            Pay by card — you'll get a receipt right after.
          </template>
          <template v-else>
            Pay the tradesperson directly (e-transfer, cash, etc.), then confirm here.
          </template>
        </p>
      </div>

      <div class="flex items-center gap-2 mt-4 flex-wrap">
        <Button
          label="View PDF"
          icon="pi pi-file-pdf"
          outlined
          size="small"
          :loading="renderingPdf"
          :disabled="renderingPdf"
          @click="openPdfPreview"
        />
        <RouterLink
          v-if="(job.status === 'complete' || job.status === 'reviewed') && invoicePayable"
          :to="`/invoices/${invoiceId}/receipt`"
        >
          <Button label="View receipt" icon="pi pi-file" outlined size="small" />
        </RouterLink>
      </div>
    </template>

    <Dialog
      v-model:visible="showRequestDialog"
      modal
      header="Request changes"
      :style="{ width: '30rem', maxWidth: '92vw' }"
    >
      <p class="text-sm text-[color:var(--bs-text)] mb-3">
        Tell the tradesperson what you'd like adjusted on this invoice. They'll
        see it in the job chat and can fix it before re-sending.
      </p>
      <Textarea
        v-model="requestReason"
        rows="4"
        class="w-full"
        :maxlength="1000"
        placeholder="e.g. The drain still leaks, please come back. Or — please remove the extra hour, you were here for 2."
        autofocus
      />
      <template #footer>
        <Button label="Cancel" text :disabled="requesting" @click="showRequestDialog = false" />
        <Button
          label="Send request"
          icon="pi pi-send"
          severity="warn"
          :loading="requesting"
          :disabled="requesting"
          @click="onSubmitRequest"
        />
      </template>
    </Dialog>

    <PayInvoiceDialog
      v-model:visible="showPayDialog"
      :job-id="job.id"
      :invoice-id="invoiceId"
      @paid="emit('paid')"
    />

    <PdfPreviewDialog
      v-model:visible="showPdfPreview"
      :blob="pdfBlob"
      :filename="pdfFilename"
      :title="`Invoice ${invoice.invoiceNumber}`"
    />
  </div>
</template>
