<script setup lang="ts">
import { computed } from "vue";
import TimeTrackerCard from "@/components/TimeTrackerCard.vue";
import ChangeOrdersCard from "@/components/ChangeOrdersCard.vue";
import type { JobDoc, JobExtraDoc, WithId } from "@/firebase/interfaces";
import { jobBillingType } from "@/utils/jobBilling";

const props = defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
  extras: WithId<JobExtraDoc>[];
}>();

const billingType = computed(() => jobBillingType(props.job));

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
    />
  </div>
</template>
