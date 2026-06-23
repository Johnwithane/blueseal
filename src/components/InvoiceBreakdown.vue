<script setup lang="ts">
// Read-only invoice rendering in the same visual format as QuoteBreakdown —
// line-item table with kind tags, totals, upfront-fee credit, payment
// instructions. Pure presentational: takes an in-memory invoice object so the
// client-facing card and any future surfaces can share it. Unlike the quote,
// nothing here is an estimate — the lines bill actual time and charges.
import type { InvoiceDiscount, LineItem, LineItemKind } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";

defineProps<{
  invoice: {
    lineItems: LineItem[];
    subtotal: number;
    discount?: InvoiceDiscount | null;
    discountAmount: number;
    taxTotal: number;
    total: number;
    // Only amountCents is read here, so accept any object that carries it —
    // the full InvoiceDoc credit and the FinishJobSheet preview both satisfy it.
    upfrontFeeCredit?: { amountCents: number } | null;
    paymentInstructions?: string;
    dueAt?: { toDate(): Date } | null;
  };
}>();

const { money, date } = useFormatters();

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
    <!-- On mobile the Detail column is hidden, so the two remaining columns fit
         without scrolling; keep the min-width (and scroll fallback) only from
         sm up, where the third column appears. -->
    <div class="overflow-x-auto">
      <table class="w-full text-sm border-t sm:min-w-[28rem]">
        <thead>
          <tr class="text-left text-[color:var(--bs-muted)]">
            <th class="py-1 font-medium">Item</th>
            <th class="py-1 font-medium w-32 text-right hidden sm:table-cell">Detail</th>
            <th class="py-1 font-medium w-28 text-right">Line (incl. tax)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(li, i) in invoice.lineItems" :key="i" class="border-t align-top">
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
            <td class="py-1.5 text-right text-xs text-[color:var(--bs-muted)] hidden sm:table-cell">
              <template v-if="li.kind === 'hourly'">
                {{ li.quantity }}h × {{ money(li.unitPrice) }}/hr
              </template>
              <template v-else-if="li.quantity !== 1">
                {{ li.quantity }} × {{ money(li.unitPrice) }}
              </template>
            </td>
            <td class="py-1.5 text-right whitespace-nowrap">
              {{ money(Math.round(li.quantity * li.unitPrice * (1 + (li.taxRate ?? 0)))) }}
            </td>
          </tr>
        </tbody>
        <tfoot class="border-t">
          <tr>
            <td colspan="2" class="py-1 text-right text-[color:var(--bs-muted)]">Subtotal</td>
            <td class="py-1 text-right">{{ money(invoice.subtotal) }}</td>
          </tr>
          <tr v-if="invoice.discountAmount > 0" class="text-[color:var(--bs-blue)]">
            <td colspan="2" class="py-1 text-right">
              Discount
              <span v-if="invoice.discount?.label" class="text-xs text-[color:var(--bs-muted)]">
                ({{ invoice.discount.label }})
              </span>
            </td>
            <td class="py-1 text-right">−{{ money(invoice.discountAmount) }}</td>
          </tr>
          <tr>
            <td colspan="2" class="py-1 text-right text-[color:var(--bs-muted)]">Tax</td>
            <td class="py-1 text-right">{{ money(invoice.taxTotal) }}</td>
          </tr>
          <tr
            v-if="invoice.upfrontFeeCredit && invoice.upfrontFeeCredit.amountCents > 0"
            class="text-[color:var(--bs-blue-dark)]"
          >
            <td colspan="2" class="py-1 text-right text-xs">
              <i class="pi pi-wallet text-[10px]"></i>
              Less upfront fee paid
            </td>
            <td class="py-1 text-right font-semibold text-xs">
              −{{ money(invoice.upfrontFeeCredit.amountCents) }}
            </td>
          </tr>
          <tr>
            <td colspan="2" class="py-1 text-right font-semibold">Total due</td>
            <td class="py-1 text-right font-bold">{{ money(invoice.total) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div v-if="invoice.dueAt" class="text-xs text-[color:var(--bs-muted)] mt-2">
      <i class="pi pi-calendar text-[10px]"></i>
      Due {{ date(invoice.dueAt) }}
    </div>

    <div
      v-if="invoice.paymentInstructions"
      class="mt-3 rounded-lg bg-[color:var(--bs-surface-alt,#f9fafb)] p-3"
    >
      <div class="text-xs font-semibold text-[color:var(--bs-muted)] mb-1">How to pay</div>
      <p class="text-xs whitespace-pre-wrap">{{ invoice.paymentInstructions }}</p>
    </div>
  </div>
</template>
