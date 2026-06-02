<script setup lang="ts">
import Button from "primevue/button";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import StatusBanner from "@/components/StatusBanner.vue";

const props = defineProps<{
  job: WithId<JobDoc>;
  isTradie: boolean;
  isClient: boolean;
}>();

const emit = defineEmits<{
  "update-invoice": [];
}>();

const { relativeTime } = useFormatters();
</script>

<template>
  <!-- Tradie view: actionable. Drives them to update the existing invoice
       draft via the Finish-job sheet so the client sees a revised total. -->
  <StatusBanner
    v-if="isTradie"
    severity="action"
    icon="pi-undo"
    title="Client requested changes"
  >
    <template #body>
      <p v-if="props.job.clientChangesRequestedReason" class="text-sm mt-1 italic">
        "{{ props.job.clientChangesRequestedReason }}"
      </p>
      <p class="text-xs text-[color:var(--bs-muted)] mt-2">
        Adjust the wrap-up and re-send for approval.
        <span v-if="props.job.clientChangesRequestedAt">
          Requested {{ relativeTime(props.job.clientChangesRequestedAt) }}.
        </span>
      </p>
    </template>
    <template #actions>
      <Button
        label="Update invoice"
        icon="pi pi-pencil"
        severity="warn"
        class="w-full"
        @click="emit('update-invoice')"
      />
    </template>
  </StatusBanner>

  <!-- Client view: passive confirmation that the ball is in the other
       court. Mirrors the "Waiting on a revised quote" stub used for the
       quote-decline flow. -->
  <StatusBanner
    v-else-if="isClient"
    severity="waiting"
    icon="pi-hourglass"
    title="Waiting on a revised invoice"
  >
    <template #body>
      <p v-if="props.job.clientChangesRequestedReason" class="text-sm mt-1 italic">
        You asked: "{{ props.job.clientChangesRequestedReason }}"
      </p>
      <p class="text-xs text-[color:var(--bs-muted)] mt-2">
        The tradesperson will update the invoice and re-send — you'll see
        a fresh approve/request-changes prompt here when it arrives.
      </p>
    </template>
  </StatusBanner>
</template>
