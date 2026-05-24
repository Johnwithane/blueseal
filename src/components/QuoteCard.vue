<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { subscribeQuote, getQuoteByJobId, markQuoteViewed } from "@/firebase/services/quotes";
import type { QuoteDoc, QuoteStatus, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";

const props = defineProps<{
  jobId: string;
  canEdit: boolean;
  /** When true, mark the quote as viewed on first load (client-side read-receipt). */
  stampViewedOnLoad?: boolean;
}>();

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
          <th class="py-1 font-medium">Description</th>
          <th class="py-1 font-medium w-16 text-right">Qty</th>
          <th class="py-1 font-medium w-28 text-right">Unit</th>
          <th class="py-1 font-medium w-28 text-right">Line</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(li, i) in quote.lineItems" :key="i" class="border-t align-top">
          <td class="py-1.5">{{ li.description }}</td>
          <td class="py-1.5 text-right">{{ li.quantity }}</td>
          <td class="py-1.5 text-right">{{ money(li.unitPrice) }}</td>
          <td class="py-1.5 text-right">{{ money(li.quantity * li.unitPrice) }}</td>
        </tr>
      </tbody>
      <tfoot class="border-t">
        <tr>
          <td colspan="3" class="py-1 text-right text-[color:var(--bs-muted)]">Subtotal</td>
          <td class="py-1 text-right">{{ money(quote.subtotal) }}</td>
        </tr>
        <tr
          v-if="quote.discountAmount > 0"
          class="text-[color:var(--bs-blue)]"
        >
          <td colspan="3" class="py-1 text-right">
            Discount
            <span
              v-if="quote.discount?.label"
              class="text-xs text-[color:var(--bs-muted)]"
            >({{ quote.discount.label }})</span>
          </td>
          <td class="py-1 text-right">−{{ money(quote.discountAmount) }}</td>
        </tr>
        <tr>
          <td colspan="3" class="py-1 text-right text-[color:var(--bs-muted)]">Tax</td>
          <td class="py-1 text-right">{{ money(quote.taxTotal) }}</td>
        </tr>
        <tr>
          <td colspan="3" class="py-1 text-right font-semibold">Total</td>
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

    <div v-if="props.canEdit" class="flex items-center gap-2 mt-4">
      <Button
        v-if="quote.status !== 'accepted'"
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
    </div>
  </div>
</template>
