<script setup lang="ts">
import Button from "primevue/button";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";

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
  <div
    v-if="isTradie"
    class="bs-card p-4 border-l-4 border-l-amber-500"
  >
    <div class="flex items-start gap-3">
      <i class="pi pi-undo text-amber-600 text-xl mt-0.5"></i>
      <div class="min-w-0 flex-1">
        <div class="font-semibold text-base">Client requested changes</div>
        <p
          v-if="props.job.clientChangesRequestedReason"
          class="text-sm mt-1 italic"
        >
          "{{ props.job.clientChangesRequestedReason }}"
        </p>
        <p class="text-xs text-[color:var(--bs-muted)] mt-2">
          Adjust the wrap-up and re-send for approval.
          <span v-if="props.job.clientChangesRequestedAt">
            Requested {{ relativeTime(props.job.clientChangesRequestedAt) }}.
          </span>
        </p>
      </div>
    </div>

    <Button
      label="Update invoice"
      icon="pi pi-pencil"
      severity="warn"
      class="mt-3 w-full"
      @click="emit('update-invoice')"
    />
  </div>

  <!-- Client view: passive confirmation that the ball is in the other
       court. Mirrors the "Waiting on a revised quote" stub used for the
       quote-decline flow. -->
  <div
    v-else-if="isClient"
    class="bs-card p-4 border-l-4 border-l-slate-400"
  >
    <div class="flex items-start gap-3">
      <i class="pi pi-hourglass text-slate-500 text-xl mt-0.5"></i>
      <div class="min-w-0 flex-1">
        <div class="font-semibold text-base">Waiting on a revised invoice</div>
        <p
          v-if="props.job.clientChangesRequestedReason"
          class="text-sm mt-1 italic"
        >
          You asked: "{{ props.job.clientChangesRequestedReason }}"
        </p>
        <p class="text-xs text-[color:var(--bs-muted)] mt-2">
          The tradesperson will update the invoice and re-send — you'll see
          a fresh approve/request-changes prompt here when it arrives.
        </p>
      </div>
    </div>
  </div>
</template>
