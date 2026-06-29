<script setup lang="ts">
import { ref, watch } from "vue";
import Checkbox from "primevue/checkbox";
import BaseSignatureDialog from "@/components/BaseSignatureDialog.vue";
import {
  TRADIE_WAIVER_TITLE,
  TRADIE_WAIVER_POINTS,
  TRADIE_WAIVER_CHECKBOX,
  TRADIE_WAIVER_FOOTNOTE,
} from "@/data/insuranceWaiver";
import { INSURANCE_PARTNER } from "@/data/insurancePartner";

// The assigned tradesperson signs the per-job "I'm working without insurance"
// waiver before they can start work. Pure capture — the parent owns the network
// call (signUninsuredWaiver) and drives the Confirm spinner via `busy`. The
// drawn signature is the record that they chose to proceed uninsured.
const props = defineProps<{
  visible: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  confirm: [dataUrl: string];
}>();

const agreed = ref(false);

// Re-arm the checkbox each open so a previous session can't carry through.
watch(
  () => props.visible,
  (v) => {
    if (v) agreed.value = false;
  },
);
</script>

<template>
  <BaseSignatureDialog
    :visible="props.visible"
    :busy="props.busy"
    :header="TRADIE_WAIVER_TITLE"
    confirm-label="Sign waiver"
    confirm-severity="warn"
    :confirm-disabled="!agreed"
    @update:visible="(v) => emit('update:visible', v)"
    @confirm="(dataUrl) => emit('confirm', dataUrl)"
  >
    <div
      class="rounded-md border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] px-3 py-2.5"
    >
      <p class="text-sm font-semibold text-[color:var(--bs-warning-text)]">
        <i class="pi pi-shield mr-1"></i>You're not insured for this job
      </p>
      <ul class="mt-2 space-y-1.5">
        <li
          v-for="point in TRADIE_WAIVER_POINTS"
          :key="point"
          class="flex items-start gap-2 text-xs text-[color:var(--bs-warning-text)]"
        >
          <i class="pi pi-check text-[0.65rem] mt-0.5"></i>
          <span>{{ point }}</span>
        </li>
      </ul>
    </div>

    <!-- Positive way out: get covered (and skip this waiver next time). -->
    <a
      :href="INSURANCE_PARTNER.url"
      target="_blank"
      rel="noopener noreferrer"
      class="mt-3 flex items-center gap-2 rounded-md border border-[color:var(--bs-blue)] px-3 py-2 text-sm font-semibold text-[color:var(--bs-blue-dark)]"
    >
      <i class="pi pi-shield" aria-hidden="true"></i>
      <span>Get insured in minutes</span>
      <i class="pi pi-external-link ml-auto text-[0.72rem] opacity-70" aria-hidden="true"></i>
    </a>

    <label class="mt-3 flex items-start gap-2 text-sm text-[color:var(--bs-text)]">
      <Checkbox v-model="agreed" binary :disabled="props.busy" />
      <span>{{ TRADIE_WAIVER_CHECKBOX }}</span>
    </label>

    <template #below-canvas>
      <p class="mt-2 text-[0.7rem] leading-snug text-[color:var(--bs-muted)]">
        {{ TRADIE_WAIVER_FOOTNOTE }}
      </p>
    </template>
  </BaseSignatureDialog>
</template>
