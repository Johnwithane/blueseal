<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { subscribeQuote, getQuoteByJobId, markQuoteViewed } from "@/firebase/services/quotes";
import { getInvoicePartyInfo } from "@/firebase/services/jobs";
import { ref as storageRef, getDownloadURL } from "firebase/storage";
import { storage } from "@/firebase/config";
import type { QuoteDoc, QuoteStatus, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { usePdfDocument } from "@/composables/usePdfDocument";
import PdfPreviewDialog from "@/components/PdfPreviewDialog.vue";
import QuoteBreakdown from "@/components/QuoteBreakdown.vue";

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

// Local open/close state — initialised from defaultCollapsed but the user
// toggles it freely after that.
const collapsed = ref(false);
watch(
  () => props.defaultCollapsed,
  (v) => {
    collapsed.value = !!v;
  },
  { immediate: true },
);

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
  unsub = subscribeQuote(
    id,
    (q) => {
      quote.value = q;
      if (q && props.stampViewedOnLoad && q.status === "sent") {
        // Best-effort: only the client has the rules permission for this
        // transition, so silent failure on tradesperson side is expected.
        void markQuoteViewed(id);
      }
    },
  );
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

watch(() => props.jobId, () => {
  detach();
  loading.value = true;
  void findQuoteId();
}, { immediate: true });

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

</script>

<template>
  <div v-if="loading" class="bs-card p-4">
    <div class="text-sm text-[color:var(--bs-muted)]">Loading quote…</div>
  </div>

  <div v-else-if="quote" class="bs-card p-4">
    <!-- Header doubles as the collapse toggle so a tap anywhere on it
         opens/closes the quote body. The status tag stays visible
         while collapsed so the user knows the state without expanding. -->
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
          <h3 class="font-semibold">Quote</h3>
          <div class="text-xs text-[color:var(--bs-muted)] truncate">
            {{ quote.quoteNumber }}
            <template v-if="quote.sentAt"> • Sent {{ date(quote.sentAt) }}</template>
          </div>
        </div>
      </div>
      <Tag :value="STATUS_LABEL[quote.status]" :severity="STATUS_SEVERITY[quote.status]" />
    </button>

    <template v-if="!collapsed">
    <QuoteBreakdown :quote="quote" :expired="quote.status === 'expired'" />

    <div
      v-if="quote.status === 'declined' && quote.declinedReason"
      class="mt-3 rounded-lg border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] p-3"
    >
      <div class="text-xs font-semibold text-[color:var(--bs-warning-text)] mb-1">Client asked to discuss</div>
      <p class="text-xs text-[color:var(--bs-warning-text)] whitespace-pre-wrap">{{ quote.declinedReason }}</p>
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
    </template>

    <PdfPreviewDialog
      v-model:visible="showPdfPreview"
      :blob="pdfBlob"
      :filename="pdfFilename"
      :title="`Quote ${quote.quoteNumber}`"
    />
  </div>
</template>
