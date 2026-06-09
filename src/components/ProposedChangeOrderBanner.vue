<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import StatusBanner from "@/components/StatusBanner.vue";
import type { JobExtraDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";

// Client-facing nudge for change orders awaiting approval. Surfaces at the top
// of the job page from any tab so the client doesn't miss a request, then
// routes them to the Work Order tab to approve/decline (single source of truth
// for the actual decision lives in ChangeOrdersCard).
const props = defineProps<{
  proposed: WithId<JobExtraDoc>[];
}>();

const emit = defineEmits<{ review: [] }>();

const { money } = useFormatters();

const first = computed(() => props.proposed[0] ?? null);
const extraCount = computed(() => props.proposed.length);

function priceLabel(ex: WithId<JobExtraDoc>): string {
  return ex.billingType === "hourly"
    ? `${money(ex.hourlyRateCents ?? 0)}/hr`
    : money(ex.flatAmountCents ?? 0);
}
</script>

<template>
  <StatusBanner
    v-if="extraCount > 0"
    severity="action"
    icon="pi-plus-circle"
    :title="extraCount === 1 ? 'Change order needs your approval' : `${extraCount} change orders need your approval`"
  >
    <template #body>
      <p v-if="first" class="text-sm text-[color:var(--bs-muted)] mt-1">
        {{ first.description }} — <span class="font-medium">{{ priceLabel(first) }}</span>
        <span v-if="extraCount > 1"> and {{ extraCount - 1 }} more</span>.
        Approve or decline before the tradesperson bills it.
      </p>
    </template>
    <template #actions>
      <Button
        label="Review & decide"
        icon="pi pi-arrow-right"
        icon-pos="right"
        @click="emit('review')"
      />
    </template>
  </StatusBanner>
</template>
