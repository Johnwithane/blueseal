<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import { subscribeQuote, getQuoteByJobId, markQuoteViewed } from "@/firebase/services/quotes";
import { getInvoicePartyInfo } from "@/firebase/services/jobs";
import { ref as storageRef, getDownloadURL } from "firebase/storage";
import { storage } from "@/firebase/config";
import type { QuoteDoc, QuoteStatus, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { usePdfDocument } from "@/composables/usePdfDocument";
import PdfPreviewDialog from "@/components/PdfPreviewDialog.vue";
import QuoteBreakdown from "@/components/QuoteBreakdown.vue";
import CollapsibleDocumentCard from "@/components/CollapsibleDocumentCard.vue";

const props = defineProps<{
  jobId: string;
  canEdit: boolean;
  /** When true, mark the quote as viewed on first load (client-side read-receipt). */
  stampViewedOnLoad?: boolean;
  /** Names denormalized on the job — used for the PDF "From"/"To" header. */
  tradespersonName?: string | null;
  clientName?: string | null;
  /** When true, start collapsed (header-only). User can toggle open. */
  defaultCollapsed?: boolean;
}>();

// Preview on desktop; download to the OS viewer on touch (see usePdfDocument).
const { renderingPdf, pdfBlob, pdfFilename, showPdfPreview, downloadMode, present } =
  usePdfDocument();

function openPdfPreview() {
  const q = quote.value;
  if (!q) return;
  void present(async () => {
    const [{ renderQuotePdfBlob }, party] = await Promise.all([
      import("@/utils/pdfRender"),
      getInvoicePartyInfo(props.jobId),
    ]);
    return renderQuotePdfBlob(q, party);
  });
}

const emit = defineEmits<{
  revise: [];
}>();

const { date } = useFormatters();

const quote = ref<WithId<QuoteDoc> | null>(null);
const loading = ref(true);
const quoteId = ref<string | null>(null);

let unsub: (() => void) | null = null;

async function findQuoteId() {
  // Quote id == jobId per submitQuote convention; getQuoteByJobId falls
  // back to a where() query for any deviation. Skip subscribe if there's
  // simply no quote yet.
  const existing = await getQuoteByJobId(props.jobId);
  quoteId.value = existing?.id ?? null;
  loading.value = false;
  if (existing) attach(existing.id);
}

function attach(id: string) {
  unsub?.();
  unsub = subscribeQuote(id, (q) => {
    quote.value = q;
    if (q && props.stampViewedOnLoad && q.status === "sent") {
      // Best-effort: only the client has the rules permission for this
      // transition, so silent failure on tradesperson side is expected.
      void markQuoteViewed(id);
    }
  });
}

function detach() {
  unsub?.();
  unsub = null;
}

// Resolve the client's acceptance signature (stored as a storage path on the
// quote) to a download URL so both parties can see the record of agreement.
// Best-effort: a missing/forbidden object just hides the block.
const signatureUrl = ref<string | null>(null);
watch(
  () => quote.value?.clientSignatureStoragePath ?? null,
  async (path) => {
    if (!path) {
      signatureUrl.value = null;
      return;
    }
    try {
      signatureUrl.value = await getDownloadURL(storageRef(storage, path));
    } catch {
      signatureUrl.value = null;
    }
  },
  { immediate: true },
);

watch(
  () => props.jobId,
  () => {
    detach();
    loading.value = true;
    void findQuoteId();
  },
  { immediate: true },
);

onBeforeUnmount(detach);

const STATUS_SEVERITY: Record<QuoteStatus, "info" | "warn" | "success" | "danger" | "secondary"> = {
  draft: "secondary",
  sent: "info",
  viewed: "info",
  accepted: "success",
  declined: "warn",
  expired: "danger",
  withdrawn: "secondary",
};

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Discussion",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

// Quote number, plus the sent date once it's been sent — the header subtitle.
const subtitle = computed(() => {
  const q = quote.value;
  if (!q) return "";
  return q.sentAt ? `${q.quoteNumber} • Sent ${date(q.sentAt)}` : q.quoteNumber;
});
</script>

<template>
  <div v-if="loading" class="bs-card p-4">
    <div class="text-sm text-[color:var(--bs-muted)]">Loading quote…</div>
  </div>

  <CollapsibleDocumentCard
    v-else-if="quote"
    title="Quote"
    :subtitle="subtitle"
    :status-label="STATUS_LABEL[quote.status]"
    :status-severity="STATUS_SEVERITY[quote.status]"
    :default-collapsed="props.defaultCollapsed"
  >
    <QuoteBreakdown :quote="quote" :expired="quote.status === 'expired'" />

    <div
      v-if="quote.status === 'declined' && quote.declinedReason"
      class="mt-3 rounded-lg border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] p-3"
    >
      <div class="text-xs font-semibold text-[color:var(--bs-warning-text)] mb-1">
        Client asked to discuss
      </div>
      <p class="text-xs text-[color:var(--bs-warning-text)] whitespace-pre-wrap">
        {{ quote.declinedReason }}
      </p>
    </div>

    <div
      v-if="quote.status === 'accepted' && signatureUrl"
      class="mt-3 rounded-lg border border-[color:var(--bs-border)] bg-white p-3"
    >
      <div class="text-xs font-semibold text-[color:var(--bs-muted)] mb-1">
        Signed by client<template v-if="quote.acceptedAt"> • {{ date(quote.acceptedAt) }}</template>
      </div>
      <img :src="signatureUrl" alt="Client signature" class="h-16 w-auto max-w-[180px]" />
    </div>

    <div class="flex items-center gap-2 mt-4 flex-wrap">
      <Button
        v-if="props.canEdit && quote.status !== 'accepted'"
        :label="quote.status === 'declined' ? 'Revise & re-send' : 'Edit & re-send'"
        icon="pi pi-pencil"
        outlined
        size="small"
        @click="emit('revise')"
      />
      <Button
        :label="downloadMode ? 'Download PDF' : 'View PDF'"
        :icon="downloadMode ? 'pi pi-download' : 'pi pi-file-pdf'"
        outlined
        size="small"
        :loading="renderingPdf"
        :disabled="renderingPdf"
        @click="openPdfPreview"
      />
    </div>

    <template #footer>
      <PdfPreviewDialog
        v-model:visible="showPdfPreview"
        :blob="pdfBlob"
        :filename="pdfFilename"
        :title="`Quote ${quote.quoteNumber}`"
      />
    </template>
  </CollapsibleDocumentCard>
</template>
