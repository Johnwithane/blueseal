<script setup lang="ts">
import Button from "primevue/button";
import { RouterLink } from "vue-router";
import QuoteCard from "@/components/QuoteCard.vue";
import InvoiceEditor from "@/components/InvoiceEditor.vue";
import ExpensesCard from "@/components/ExpensesCard.vue";
import ReviewPrompt from "@/components/ReviewPrompt.vue";
import type { JobDoc, WithId } from "@/firebase/interfaces";

defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
  invoiceId: string | null;
  // True only when the invoice was sent through the Stripe Connect
  // pipeline (clientSecret available). Legacy "mark paid" / manual
  // invoices have no in-app pay or receipt page, so the CTAs below
  // gate on this in addition to invoiceId.
  invoicePayable: boolean;
  markingPaid: boolean;
}>();

const emit = defineEmits<{
  "mark-paid": [];
  "revise-quote": [];
  reviewed: [];
}>();
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

    <!-- Client: the invoice is sent, payment is due. The InvoiceEditor
         below renders the breakdown read-only; this card surfaces the
         primary action (pay now → Stripe checkout). Without it the
         client has no in-app payment affordance and ends up hunting
         for an email link. -->
    <div
      v-if="isClient && job.status === 'awaiting_payment' && invoiceId && invoicePayable"
      class="bs-card p-3 border-l-4 border-l-emerald-500"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-wallet text-emerald-600"></i>
        Invoice ready to pay
      </h3>
      <p class="text-xs text-[color:var(--bs-muted)] mb-3">
        Pay by card to close out the job — you'll get a receipt right after.
      </p>
      <RouterLink :to="`/invoices/${invoiceId}/pay`" class="block">
        <Button
          label="Pay invoice"
          icon="pi pi-credit-card"
          severity="success"
          class="w-full"
        />
      </RouterLink>
    </div>

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
      @revise="emit('revise-quote')"
    />

    <!-- Invoice (renders only when one exists). -->
    <InvoiceEditor v-if="invoiceId" :invoice-id="invoiceId" :can-edit="isTradie" />

    <!-- No-invoice empty state, only when there's also no quote drafted. -->
    <div
      v-if="!invoiceId && (job.status === 'requested' || job.status === 'in_progress')"
      class="bs-empty"
    >
      <i class="pi pi-receipt text-2xl mb-2 block text-[color:var(--bs-muted)]"></i>
      <p class="text-sm font-medium">No invoice yet</p>
      <p class="text-xs text-[color:var(--bs-muted)] mt-1">
        The invoice draft is generated when the tradesperson uses
        <span class="font-medium">Create and send invoice</span>.
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
