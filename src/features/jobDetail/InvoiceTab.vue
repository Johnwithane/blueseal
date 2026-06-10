<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import { RouterLink } from "vue-router";
import QuoteCard from "@/components/QuoteCard.vue";
import InvoiceEditor from "@/components/InvoiceEditor.vue";
import PayInvoiceDialog from "@/components/PayInvoiceDialog.vue";
import type { JobDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
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
  paid: [];
  done: [];
}>();

const showPayDialog = ref(false);

// "Mark job as done" — offered once the invoice is paid (status complete /
// reviewed) and the viewer hasn't already filed their side. Reuses the
// per-party archive (handled in JobDetailView); the job, invoice, receipt and
// reviews all stay readable from the dashboard's Completed view afterwards.
const viewerArchived = computed(() => {
  const j = props.job;
  if (props.isClient) return j.clientArchivedAt != null;
  if (props.isTradie) return j.tradespersonArchivedAt != null;
  return true;
});
const canMarkDone = computed(
  () =>
    (props.isClient || props.isTradie) &&
    (props.job.status === "complete" || props.job.status === "reviewed") &&
    !viewerArchived.value,
);

function openPayDialog() {
  showPayDialog.value = true;
}

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
    <!-- Job is paid + wrapped up — offer to file it away. Per-party: archives
         only the viewer's side (handled in JobDetailView), then drops them back
         on the dashboard. The job + invoice + receipt + reviews stay intact and
         reopenable from the Completed view. -->
    <div
      v-if="canMarkDone"
      class="bs-card p-4 border-l-4 border-l-[color:var(--bs-success)]"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-check-circle text-[color:var(--bs-success)]"></i>
        All wrapped up
      </h3>
      <p class="text-xs text-[color:var(--bs-muted)] mb-3">
        File this job away to move it to your Completed list. The invoice,
        receipt and reviews stay here — you can reopen it anytime.
      </p>
      <Button
        label="Mark job as done"
        icon="pi pi-check"
        severity="success"
        class="w-full"
        @click="emit('done')"
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
        Payment received?
      </h3>
      <p class="text-xs text-[color:var(--bs-muted)] mb-3">
        Mark the invoice paid to close out the job. The client gets a receipt
        and the review prompt appears.
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

    <!-- Client: invoice is approved + sent, payment is due. Two paths:
         Stripe Connect (invoicePayable === true) takes them to the in-app
         card-payment view; otherwise we open the offline-pay dialog so
         the client can mark it paid after sending the funds directly
         (e-transfer / cash / etc.). Either way they aren't stranded
         without an action. -->
    <div
      v-if="isClient && job.status === 'awaiting_payment' && invoiceId"
      class="bs-card p-3 border-l-4 border-l-[color:var(--bs-success)]"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-wallet text-[color:var(--bs-success)]"></i>
        Invoice ready to pay
      </h3>
      <p class="text-xs text-[color:var(--bs-muted)] mb-3">
        <template v-if="invoicePayable">
          Pay by card to close out the job — you'll get a receipt right after.
        </template>
        <template v-else>
          Pay the tradesperson directly (e-transfer, cash, etc.), then
          confirm here to close out the job.
        </template>
      </p>
      <RouterLink
        v-if="invoicePayable"
        :to="`/invoices/${invoiceId}/pay`"
        class="block"
      >
        <Button
          label="Pay invoice"
          icon="pi pi-credit-card"
          severity="success"
          class="w-full"
        />
      </RouterLink>
      <Button
        v-else
        label="Pay invoice"
        icon="pi pi-wallet"
        severity="success"
        class="w-full"
        @click="openPayDialog"
      />
    </div>

    <PayInvoiceDialog
      v-if="isClient && invoiceId"
      v-model:visible="showPayDialog"
      :job-id="props.job.id"
      :invoice-id="invoiceId"
      @paid="emit('paid')"
    />

    <!-- Client: post-payment receipt link. The InvoiceEditor below
         shows the line items, but the receipt view is the cleaner
         shareable artifact. -->
    <div
      v-if="isClient && (job.status === 'complete' || job.status === 'reviewed') && invoiceId && invoicePayable"
      class="bs-card p-3"
    >
      <RouterLink :to="`/invoices/${invoiceId}/receipt`" class="block">
        <Button
          label="View receipt"
          icon="pi pi-file"
          severity="secondary"
          outlined
          class="w-full"
        />
      </RouterLink>
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

    <!-- Invoice first — once it exists it's the artifact the conversation
         is really about. Renders only when one exists.
         canEdit gates write controls on top of the tradesperson check:
         once the client has approved + the invoice is sent for payment,
         the line items are locked. Editing under the client's feet after
         they've approved a specific total would be misleading; if the
         tradesperson needs to revise post-approval they go through a
         cancel/re-quote loop instead. Reviewed = same lock, just past
         payment. -->
    <InvoiceEditor
      v-if="invoiceId"
      :invoice-id="invoiceId"
      :can-edit="isTradie && !lockedStatuses.has(job.status)"
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

    <!-- No-invoice empty state, only when there's also no quote drafted. -->
    <div
      v-if="!invoiceId && (job.status === 'requested' || job.status === 'in_progress')"
      class="bs-empty"
    >
      <i class="pi pi-receipt text-2xl mb-2 block text-[color:var(--bs-muted)]"></i>
      <p class="text-sm font-medium">No invoice yet</p>
      <p class="text-xs text-[color:var(--bs-muted)] mt-1">
        The invoice draft is generated when the tradesperson uses
        <span class="font-medium">Create invoice</span>.
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
