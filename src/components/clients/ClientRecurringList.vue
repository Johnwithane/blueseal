<script setup lang="ts">
// A client's recurring charges. Lists the plans (recurring backing jobs linked
// to this contact) and hosts the "Add recurring charge" CTA. Each plan renders
// as a RecurringPlanCard.
import { onMounted, ref } from "vue";
import Button from "primevue/button";
import { listClientJobs } from "@/firebase/services/clientsService";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import RecurringPlanCard from "@/components/clients/RecurringPlanCard.vue";
import RecurringChargeDialog from "@/components/clients/RecurringChargeDialog.vue";

const props = defineProps<{ tradieUid: string; clientId: string }>();

const toast = useToast();
const plans = ref<WithId<JobDoc>[]>([]);
const loading = ref(true);
const addOpen = ref(false);

async function load() {
  loading.value = true;
  try {
    const jobs = await listClientJobs(props.tradieUid, props.clientId);
    plans.value = jobs.filter((j) => j.originType === "recurring_plan");
  } catch (e) {
    toast.error("Couldn't load recurring charges", humanizeError(e));
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-semibold">Recurring billing</h3>
      <Button label="Add recurring charge" icon="pi pi-plus" size="small" @click="addOpen = true" />
    </div>

    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)]">
      <i class="pi pi-spin pi-spinner mr-1"></i> Loading…
    </div>
    <p v-else-if="!plans.length" class="text-sm text-[color:var(--bs-muted)]">
      No recurring charges yet. Set one up and Blue Seal drafts the invoice for you to review
      and send each period.
    </p>
    <div v-else class="space-y-3">
      <RecurringPlanCard v-for="p in plans" :key="p.id" :job="p" :tradie-uid="tradieUid" />
    </div>

    <RecurringChargeDialog v-model:visible="addOpen" :client-id="clientId" @created="load" />
  </div>
</template>
