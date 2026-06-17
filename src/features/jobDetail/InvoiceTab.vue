<script setup lang="ts">
import Button from "primevue/button";
import QuoteCard from "@/components/QuoteCard.vue";
import InvoiceEditor from "@/components/InvoiceEditor.vue";
import ClientInvoiceCard from "@/components/ClientInvoiceCard.vue";
import type { JobDoc, WithId } from "@/firebase/interfaces";

defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
  invoiceId: string | null;
  // True only when the invoice was sent through the Stripe Connect
  // pipeline (clientSecret available). Drives the link to the in-app
  // /invoices/:id/pay flow (card payment). When false the client gets
  // the offline-pay dialog instead so the loop still closes.
  invoicePayable: boolean;
  markingPaid: boolean;
  // Resolved party names. The job doc carries denormalized
  // tradespersonName/clientName from create time but older test jobs
  // have them blank — JobDetailView resolves the best available
  // source (auth.displayName for the current user side, tradieInfo
  // for the other side when available) and passes the strings here.
  resolvedTradespersonName: string;
  resolvedClientName: string;
}>();

const emit = defineEmits<{
  "mark-paid": [];
  "revise-quote": [];
  /** Tradie wants the wrap-up sheet (Create / Update invoice). */
  "create-invoice": [];
  /** Approve / request-changes / paid landed — parent reloads the job. */
  decided: [];
  paid: [];
}>();

// Job statuses where the invoice should be read-only for the tradesperson.
// awaiting_client_approval: client is reviewing the exact submitted version.
// awaiting_payment / complete / reviewed: client has signed off on the total.
// Editing under them would diverge what's been agreed/paid.
const lockedStatuses = new Set<JobDoc["status"]>([
  "awaiting_client_approval",
  "awaiting_payment",
  "complete",
  "reviewed",
  "cancelled",
]);
</script>

<template>
  <div class="space-y-4">
    <!-- Tradie: create / update the invoice. This is the ONLY place the
         action lives (it used to share the page-bottom sticky CTA) — the
         invoice gets made where invoices live. -->
    <div
      v-if="isTradie && job.status === 'in_progress'"
      class="bs-card p-3 border-l-4 border-l-[color:var(--bs-blue)]"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-receipt text-[color:var(--bs-blue)]"></i>
        {{ job.clientChangesRequestedAt ? "Update the invoice" : "Finished the work?" }}
      </h3>
      <p class="text-xs text-[color:var(--bs-muted)] mb-3">
        <template v-if="job.clientChangesRequestedAt">
          The client asked for changes — adjust the wrap-up and re-send it for approval.
        </template>
        <template v-else>
          Build the invoice from your tracked time, expenses and change orders,
          then send it to the client for approval.
        </template>
      </p>
      <Button
        :label="job.clientChangesRequestedAt ? 'Update invoice' : 'Create invoice'"
        :icon="job.clientChangesRequestedAt ? 'pi pi-pencil' : 'pi pi-receipt'"
        class="w-full"
        @click="emit('create-invoice')"
      />
    </div>

    <!-- Tradie: mark-as-paid CTA when client has approved and paid offline.
         markJobPaid atomically flips invoice → paid + job → complete. -->
    <div
      v-if="isTradie && job.status === 'awaiting_payment'"
      class="bs-card p-3 border-l-4 border-l-[color:var(--bs-success)]"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-wallet text-[color:var(--bs-success)]"></i>
        {{ job.clientReportedPaidAt ? "Client says they've paid — confirm receipt" : "Payment received?" }}
      </h3>
      <p class="text-xs text-[color:var(--bs-muted)] mb-3">
        <template v-if="job.clientReportedPaidAt">
          {{ resolvedClientName || "The client" }} marked this invoice as paid.
          Confirm you've actually received it to close out the job — they get a
          receipt and the review prompt appears.
        </template>
        <template v-else>
          Mark the invoice paid to close out the job. The client gets a receipt
          and the review prompt appears.
        </template>
      </p>
      <Button
        label="Mark as paid"
        icon="pi pi-check"
        severity="success"
        class="w-full"
        :loading="markingPaid"
        @click="emit('mark-paid')"
      />
    </div>

    <!-- Tradie: ball is in the client's court — read-only confirmation. -->
    <div
      v-if="isTradie && job.status === 'awaiting_client_approval'"
      class="bs-card p-3 border-l-4 border-l-[color:var(--bs-warning)]"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-hourglass text-[color:var(--bs-warning)]"></i>
        Awaiting client approval
      </h3>
      <p class="text-xs text-[color:var(--bs-muted)]">
        The client has the wrap-up. They'll approve the work or request
        changes — you'll get a notification either way.
      </p>
    </div>

    <!-- CLIENT invoice view — top of the tab, same format as the quote
         below it. Owns approve & pay / request changes / pay / receipt. -->
    <ClientInvoiceCard
      v-if="isClient && invoiceId"
      :job="job"
      :invoice-id="invoiceId"
      :invoice-payable="invoicePayable"
      @decided="emit('decided')"
      @paid="emit('paid')"
    />

    <!-- TRADIE invoice editor — their working surface for the same doc.
         canEdit gates write controls: once the client has approved + the
         invoice is sent for payment, the line items are locked. Editing
         under the client's feet after they've approved a specific total
         would be misleading. -->
    <InvoiceEditor
      v-if="isTradie && invoiceId"
      :invoice-id="invoiceId"
      :can-edit="!lockedStatuses.has(job.status)"
      :tradesperson-name="resolvedTradespersonName"
      :client-name="resolvedClientName"
    />

    <!-- Quote second — it's the historical agreement. Defaults to
         collapsed once an invoice exists (the invoice is the live
         document). Renders nothing until a quote is drafted. -->
    <QuoteCard
      :job-id="job.id"
      :can-edit="isTradie"
      :stamp-viewed-on-load="isClient"
      :tradesperson-name="resolvedTradespersonName"
      :client-name="resolvedClientName"
      :default-collapsed="!!invoiceId"
      @revise="emit('revise-quote')"
    />

    <!-- No-invoice empty state for the client, only pre-invoice. -->
    <div
      v-if="!invoiceId && !isTradie && (job.status === 'requested' || job.status === 'in_progress')"
      class="bs-empty"
    >
      <i class="pi pi-receipt text-2xl mb-2 block text-[color:var(--bs-muted)]"></i>
      <p class="text-sm font-medium">No invoice yet</p>
      <p class="text-xs text-[color:var(--bs-muted)] mt-1">
        The invoice appears here once the tradesperson wraps up the work.
      </p>
    </div>

    <!-- Receipts (the tradesperson's expense uploader) live on the Work
         Order tab now — alongside time + change orders, where the live work
         of the job is tracked. They no longer belong on the invoice surface. -->

    <!-- Mutual review lives at the JobDetailView level (above the
         tabs) so revealed reviews land at the top of every tab, not
         buried under the invoice. Nothing to mount here. -->
  </div>
</template>
