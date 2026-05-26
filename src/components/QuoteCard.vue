<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { subscribeQuote, getQuoteByJobId, markQuoteViewed } from "@/firebase/services/quotes";
import type { LineItemKind, QuoteDoc, QuoteStatus, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  jobId: string;
  canEdit: boolean;
  /** When true, mark the quote as viewed on first load (client-side read-receipt). */
  stampViewedOnLoad?: boolean;
  /** Names denormalized on the job — used for the PDF "From"/"To" header. */
  tradespersonName?: string | null;
  clientName?: string | null;
}>();

const toast = useToast();
const downloadingPdf = ref(false);

async function downloadPdf() {
  if (!quote.value || downloadingPdf.value) return;
  downloadingPdf.value = true;
  try {
    const { downloadQuotePdf } = await import("@/utils/pdfRender");
    await downloadQuotePdf(
      quote.value,
      { name: props.tradespersonName?.trim() || "Tradesperson" },
      { name: props.clientName?.trim() || "Client" },
    );
  } catch (e) {
    toast.error("Couldn't render PDF", humanizeError(e));
  } finally {
    downloadingPdf.value = false;
  }
}

const emit = defineEmits<{
  revise: [];
}>();

const { money, date } = useFormatters();

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

const KIND_LABEL: Record<LineItemKind, string> = {
  hourly: "Hourly",
  labour: "Labour",
  materials: "Materials",
};
const KIND_ICON: Record<LineItemKind, string> = {
  hourly: "pi-clock",
  labour: "pi-wrench",
  materials: "pi-box",
};
</script>

<template>
  <div v-if="loading" class="bs-card p-4">
    <div class="text-sm text-[color:var(--bs-muted)]">Loading quote…</div>
  </div>

  <div v-else-if="quote" class="bs-card p-4">
    <header class="flex items-center justify-between mb-3">
      <div>
        <h3 class="font-semibold">Quote</h3>
        <div class="text-xs text-[color:var(--bs-muted)]">
          {{ quote.quoteNumber }}
          <template v-if="quote.sentAt"> • Sent {{ date(quote.sentAt) }}</template>
        </div>
      </div>
      <Tag :value="STATUS_LABEL[quote.status]" :severity="STATUS_SEVERITY[quote.status]" />
    </header>

    <div v-if="quote.noteToClient" class="text-sm whitespace-pre-wrap mb-3 italic">
      "{{ quote.noteToClient }}"
    </div>

    <table class="w-full text-sm border-t">
      <thead>
        <tr class="text-left text-[color:var(--bs-muted)]">
          <th class="py-1 font-medium">Item</th>
          <th class="py-1 font-medium w-32 text-right hidden sm:table-cell">Detail</th>
          <th class="py-1 font-medium w-28 text-right">Line</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(li, i) in quote.lineItems" :key="i" class="border-t align-top">
          <td class="py-1.5">
            <div class="flex items-start gap-2">
              <span
                v-if="li.kind"
                class="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                :class="
                  li.kind === 'hourly'
                    ? 'bg-blue-100 text-blue-700'
                    : li.kind === 'materials'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-700'
                "
              >
                <i :class="['pi', 'text-[9px]', KIND_ICON[li.kind]]"></i>
                {{ KIND_LABEL[li.kind] }}
              </span>
              <span class="min-w-0">{{ li.description }}</span>
            </div>
          </td>
          <td class="py-1.5 text-right text-xs text-[color:var(--bs-muted)]">
            <template v-if="li.kind === 'hourly'">
              {{ li.quantity }}h × {{ money(li.unitPrice) }}/hr
            </template>
            <template v-else-if="li.quantity !== 1">
              {{ li.quantity }} × {{ money(li.unitPrice) }}
            </template>
          </td>
          <td class="py-1.5 text-right">{{ money(li.quantity * li.unitPrice) }}</td>
        </tr>
      </tbody>
      <tfoot class="border-t">
        <tr>
          <td colspan="2" class="py-1 text-right text-[color:var(--bs-muted)]">Subtotal</td>
          <td class="py-1 text-right">{{ money(quote.subtotal) }}</td>
        </tr>
        <tr
          v-if="quote.discountAmount > 0"
          class="text-[color:var(--bs-blue)]"
        >
          <td colspan="2" class="py-1 text-right">
            Discount
            <span
              v-if="quote.discount?.label"
              class="text-xs text-[color:var(--bs-muted)]"
            >({{ quote.discount.label }})</span>
          </td>
          <td class="py-1 text-right">−{{ money(quote.discountAmount) }}</td>
        </tr>
        <tr>
          <td colspan="2" class="py-1 text-right text-[color:var(--bs-muted)]">Tax</td>
          <td class="py-1 text-right">{{ money(quote.taxTotal) }}</td>
        </tr>
        <tr>
          <td colspan="2" class="py-1 text-right font-semibold">Total</td>
          <td class="py-1 text-right font-bold">{{ money(quote.total) }}</td>
        </tr>
      </tfoot>
    </table>

    <div v-if="quote.estimatedHours" class="text-xs text-[color:var(--bs-muted)] mt-2">
      Estimated time: {{ quote.estimatedHours }} hours
    </div>

    <div
      v-if="quote.validUntil"
      class="text-xs mt-2"
      :class="quote.status === 'expired' ? 'text-red-600' : 'text-[color:var(--bs-muted)]'"
    >
      <i class="pi pi-calendar text-[10px]"></i>
      Valid until {{ date(quote.validUntil) }}
    </div>

    <div
      v-if="quote.terms"
      class="mt-3 rounded-lg bg-[color:var(--bs-surface-alt,#f9fafb)] p-3"
    >
      <div class="text-xs font-semibold text-[color:var(--bs-muted)] mb-1">Terms / exclusions</div>
      <p class="text-xs whitespace-pre-wrap">{{ quote.terms }}</p>
    </div>

    <div
      v-if="quote.status === 'declined' && quote.declinedReason"
      class="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3"
    >
      <div class="text-xs font-semibold text-amber-900 mb-1">Client asked to discuss</div>
      <p class="text-xs text-amber-900 whitespace-pre-wrap">{{ quote.declinedReason }}</p>
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
      <a
        v-if="quote.pdfUrl"
        :href="quote.pdfUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button label="Download PDF" icon="pi pi-download" outlined size="small" />
      </a>
      <Button
        v-else
        label="Download PDF"
        icon="pi pi-download"
        outlined
        size="small"
        :loading="downloadingPdf"
        :disabled="downloadingPdf"
        @click="downloadPdf"
      />
    </div>
  </div>
</template>
