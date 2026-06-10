<script setup lang="ts">
// Read-only quote rendering: note, line-item table, totals, upfront fee,
// estimate, validity, terms. Pure presentational — takes an in-memory quote
// object so it works for both a materialized QuoteDoc (QuoteCard) and an
// application's embedded ApplicationQuote (marketplace applicant cards).
import { computed } from "vue";
import type { InvoiceDiscount, LineItem, LineItemKind, QuoteUpfrontFee } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";

const props = defineProps<{
  quote: {
    lineItems: LineItem[];
    subtotal: number;
    discount?: InvoiceDiscount | null;
    discountAmount: number;
    taxTotal: number;
    total: number;
    upfrontFee?: QuoteUpfrontFee | null;
    estimatedHours?: number | null;
    proposedStartDate?: { toDate(): Date } | null;
    estimatedDuration?: string;
    validUntil?: { toDate(): Date } | null;
    terms?: string;
    noteToClient?: string;
  };
  /** Render the validity date in red (quote past its valid-until). */
  expired?: boolean;
}>();

const { money, date } = useFormatters();

// Hourly lines quote a rate × estimated hours — a ballpark, not a firm price.
// The invoice bills the tradesperson's actual clocked time instead, so when any
// hourly line is present we frame the line amounts + total as an estimate.
const hasHourly = computed(() => props.quote.lineItems.some((li) => li.kind === "hourly"));

// proposedStartDate is a calendar date stored at UTC midnight — format it in
// UTC so it reads as the same day the tradesperson picked, in every timezone.
function formatStartDate(ts: { toDate(): Date }): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(ts.toDate());
}

const KIND_LABEL: Record<LineItemKind, string> = {
  hourly: "Hourly",
  labour: "Flat rate",
  materials: "Materials",
};
const KIND_ICON: Record<LineItemKind, string> = {
  hourly: "pi-clock",
  labour: "pi-wrench",
  materials: "pi-box",
};
</script>

<template>
  <div>
    <div v-if="quote.noteToClient" class="text-sm whitespace-pre-wrap mb-3 italic">
      "{{ quote.noteToClient }}"
    </div>

    <!-- Scroll the line-item table on narrow screens instead of squishing. -->
    <div class="overflow-x-auto">
      <table class="w-full text-sm border-t min-w-[28rem]">
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
                      ? 'bg-[color:var(--bs-info-tint)] text-[color:var(--bs-info-text)]'
                      : li.kind === 'materials'
                      ? 'bg-[color:var(--bs-warning-tint)] text-[color:var(--bs-warning-text)]'
                      : 'bg-[color:var(--bs-surface-alt)] text-[color:var(--bs-text)]'
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
            <td class="py-1.5 text-right whitespace-nowrap">
              <template v-if="li.kind === 'hourly'">
                ~{{ money(Math.round(li.quantity * li.unitPrice * (1 + (li.taxRate ?? 0)))) }}
                <span class="text-[10px] text-[color:var(--bs-muted)]">est.</span>
              </template>
              <template v-else>
                {{ money(Math.round(li.quantity * li.unitPrice * (1 + (li.taxRate ?? 0)))) }}
              </template>
            </td>
          </tr>
        </tbody>
        <tfoot class="border-t">
          <tr>
            <td colspan="2" class="py-1 text-right text-[color:var(--bs-muted)]">Subtotal</td>
            <td class="py-1 text-right">{{ money(quote.subtotal) }}</td>
          </tr>
          <tr v-if="quote.discountAmount > 0" class="text-[color:var(--bs-blue)]">
            <td colspan="2" class="py-1 text-right">
              Discount
              <span v-if="quote.discount?.label" class="text-xs text-[color:var(--bs-muted)]">
                ({{ quote.discount.label }})
              </span>
            </td>
            <td class="py-1 text-right">−{{ money(quote.discountAmount) }}</td>
          </tr>
          <tr>
            <td colspan="2" class="py-1 text-right text-[color:var(--bs-muted)]">Tax</td>
            <td class="py-1 text-right">{{ money(quote.taxTotal) }}</td>
          </tr>
          <tr>
            <td colspan="2" class="py-1 text-right font-semibold">
              {{ hasHourly ? "Estimated total" : "Total" }}
            </td>
            <td class="py-1 text-right font-bold">{{ money(quote.total) }}</td>
          </tr>
          <tr
            v-if="quote.upfrontFee && quote.upfrontFee.amountCents > 0"
            class="text-[color:var(--bs-blue-dark)]"
          >
            <td colspan="2" class="py-1 text-right text-xs">
              <i class="pi pi-wallet text-[10px]"></i>
              Upfront fee before work starts
            </td>
            <td class="py-1 text-right font-semibold text-xs">
              {{ money(quote.upfrontFee.amountCents) }}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div v-if="hasHourly" class="text-xs text-[color:var(--bs-muted)] mt-2">
      <i class="pi pi-clock text-[10px]"></i>
      Hourly time is an estimate — your invoice bills the actual hours worked.
    </div>

    <div v-if="quote.estimatedHours" class="text-xs text-[color:var(--bs-muted)] mt-2">
      Estimated time: {{ quote.estimatedHours }} hours
    </div>

    <div v-if="quote.proposedStartDate" class="text-xs text-[color:var(--bs-muted)] mt-2">
      <i class="pi pi-calendar-plus text-[10px]"></i>
      Projected start: {{ formatStartDate(quote.proposedStartDate) }}
    </div>

    <div v-if="quote.estimatedDuration" class="text-xs text-[color:var(--bs-muted)] mt-2">
      <i class="pi pi-hourglass text-[10px]"></i>
      Expected duration: {{ quote.estimatedDuration }}
    </div>

    <div
      v-if="quote.validUntil"
      class="text-xs mt-2"
      :class="expired ? 'text-[color:var(--bs-danger)]' : 'text-[color:var(--bs-muted)]'"
    >
      <i class="pi pi-calendar text-[10px]"></i>
      Valid until {{ date(quote.validUntil) }}
    </div>

    <div v-if="quote.terms" class="mt-3 rounded-lg bg-[color:var(--bs-surface-alt,#f9fafb)] p-3">
      <div class="text-xs font-semibold text-[color:var(--bs-muted)] mb-1">Terms / exclusions</div>
      <p class="text-xs whitespace-pre-wrap">{{ quote.terms }}</p>
    </div>
  </div>
</template>
