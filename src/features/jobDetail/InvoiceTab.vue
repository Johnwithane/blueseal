<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import { RouterLink } from "vue-router";
import QuoteCard from "@/components/QuoteCard.vue";
import InvoiceEditor from "@/components/InvoiceEditor.vue";
import ExpensesCard from "@/components/ExpensesCard.vue";
import ReviewPrompt from "@/components/ReviewPrompt.vue";
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

    <!-- Quote (renders nothing when no quote yet — safe to always mount). -->
    <QuoteCard
      :job-id="job.id"
      :can-edit="isTradie"
      :stamp-viewed-on-load="isClient"
      :tradesperson-name="job.tradespersonName ?? null"
      :client-name="job.clientName ?? null"
      @revise="emit('revise-quote')"
    />

    <!-- Invoice (renders only when one exists). -->
    <InvoiceEditor
      v-if="invoiceId"
      :invoice-id="invoiceId"
      :can-edit="isTradie"
      :tradesperson-name="job.tradespersonName ?? null"
      :client-name="job.clientName ?? null"
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

    <!-- Mutual review after payment + completion. -->
    <div v-if="job.status === 'complete' || job.status === 'reviewed'" class="bs-card p-3">
      <h3 class="font-semibold text-sm mb-2">Reviews</h3>
      <ReviewPrompt
        :job="job"
        :as-role="isClient ? 'client' : 'tradesperson'"
        @reviewed="emit('reviewed')"
      />
    </div>
  </div>
</template>
