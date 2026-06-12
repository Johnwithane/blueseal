<script setup lang="ts">
import { computed } from "vue";
import TimeTrackerCard from "@/components/TimeTrackerCard.vue";
import ChangeOrdersCard from "@/components/ChangeOrdersCard.vue";
import ExpensesCard from "@/components/ExpensesCard.vue";
import type { JobDoc, JobStatus, WithId, JobExtraDoc } from "@/firebase/interfaces";
import { jobBillingType } from "@/utils/jobBilling";

const props = defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
  extras: WithId<JobExtraDoc>[];
}>();

const billingType = computed(() => jobBillingType(props.job));

// Receipts can only be billed through while the invoice is still open. Once
// it's locked (sent for approval → reviewed, or cancelled) a new receipt
// can't make it onto the invoice, so the uploader is hidden. Mirrors the
// InvoiceEditor's canEdit gate on the Invoice tab.
const INVOICE_LOCKED_STATUSES = new Set<JobStatus>([
  "awaiting_client_approval",
  "awaiting_payment",
  "complete",
  "reviewed",
  "cancelled",
]);
const showExpenses = computed(
  () => props.isTradie && !INVOICE_LOCKED_STATUSES.has(props.job.status),
);

// Approved hourly change orders the tradie can clock time against.
const approvedHourlyExtras = computed(() =>
  props.extras
    .filter((e) => e.status === "approved" && e.billingType === "hourly")
    .map((e) => ({ id: e.id, description: e.description, hourlyRateCents: e.hourlyRateCents ?? 0 })),
);
</script>

<template>
  <div class="space-y-4">
    <!-- Time tracking — both parties see clocked time (client sees no money on
         fixed-job base labour, per the billing rules). -->
    <TimeTrackerCard
      :job-id="job.id"
      :tradesperson-id="job.tradespersonId"
      :is-tradie="isTradie"
      :billing-type="billingType"
      :approved-hourly-extras="approvedHourlyExtras"
    />

    <ChangeOrdersCard
      :job-id="job.id"
      :is-tradie="isTradie"
      :is-client="isClient"
      :extras="extras"
      :solo="job.clientId === null"
    />

    <!-- Receipts → reimbursable line items. Tradesperson-only (receipts
         disclose the tradie's cost basis), and hidden once the invoice is
         locked. Moved here from the Invoice tab: it's part of the live work,
         not the invoice. -->
    <ExpensesCard
      v-if="showExpenses"
      :job-id="job.id"
      :client-id="job.clientId"
      :tradesperson-id="job.tradespersonId"
      :billing-type="billingType"
    />
  </div>
</template>
