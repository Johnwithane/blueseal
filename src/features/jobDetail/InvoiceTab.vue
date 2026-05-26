<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import { RouterLink } from "vue-router";
import QuoteCard from "@/components/QuoteCard.vue";
import InvoiceEditor from "@/components/InvoiceEditor.vue";
import ExpensesCard from "@/components/ExpensesCard.vue";
import MutualReviewCard from "@/components/MutualReviewCard.vue";
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
  // The OTHER party from the signed-in user's perspective. Used by
  // MutualReviewCard to render the personalized review modal header
  // (avatar + "Leave {name} a review"). Resolved upstream so the
  // photo-URL fallback chain (denormalized → public tradie doc →
  // auth profile) lives in one place.
  counterpartyName: string;
  counterpartyPhotoUrl: string | null;
  // Bumped each time JobDetailView sees ?review=1 in the URL — passed
  // straight through to MutualReviewCard so the deep link auto-opens
  // the review modal even on subsequent visits.
  reviewAutoOpenSignal?: number;
}>();

const emit = defineEmits<{
  "mark-paid": [];
  "revise-quote": [];
  reviewed: [];
  paid: [];
}>();

const showPayDialog = ref(false);

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
    <!-- Tradie: mark-as-paid CTA when client has approved and paid offline.
         markJobPaid atomically flips invoice → paid + job → complete. -->
    <div
      v-if="isTradie && job.status === 'awaiting_payment'"
      class="bs-card p-3 border-l-4 border-l-emerald-500"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-wallet text-emerald-600"></i>
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
      class="bs-card p-3 border-l-4 border-l-emerald-500"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-wallet text-emerald-600"></i>
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
      class="bs-card p-3 border-l-4 border-l-amber-500"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-hourglass text-amber-600"></i>
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

    <!-- Tradie's expenses (receipts → reimbursable line items). -->
    <ExpensesCard
      v-if="isTradie"
      :job-id="job.id"
      :client-id="job.clientId"
      :tradesperson-id="job.tradespersonId"
    />

    <!-- AirBnB-style mutual review: surface a stateful banner that owns
         the whole review loop (request → waiting → reveal). Lives here
         rather than inside JobDetailView so it sits next to the invoice
         it relates to — the user only thinks about reviewing right after
         they see the invoice closed out. -->
    <MutualReviewCard
      v-if="job.status === 'complete' || job.status === 'reviewed'"
      :job="job"
      :is-client="isClient"
      :is-tradie="isTradie"
      :counterparty-name="counterpartyName"
      :counterparty-photo-url="counterpartyPhotoUrl"
      :auto-open-signal="reviewAutoOpenSignal"
      @reviewed="emit('reviewed')"
    />
  </div>
</template>
