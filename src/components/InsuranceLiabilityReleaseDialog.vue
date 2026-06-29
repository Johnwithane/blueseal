<script setup lang="ts">
import { ref, watch } from "vue";
import Checkbox from "primevue/checkbox";
import BaseSignatureDialog from "@/components/BaseSignatureDialog.vue";
import {
  INSURANCE_RELEASE_TITLE,
  INSURANCE_RELEASE_POINTS,
  INSURANCE_RELEASE_CHECKBOX,
  INSURANCE_RELEASE_FOOTNOTE,
} from "@/data/insuranceWaiver";

// A tradesperson signs this when they upload their own insurance but are NOT
// adding Blue Seal as an additional insured. Pure capture — the parent owns the
// network call (signInsuranceLiabilityRelease) and drives the spinner via `busy`.
const props = defineProps<{
  visible: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  confirm: [dataUrl: string];
}>();

const agreed = ref(false);

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
    :header="INSURANCE_RELEASE_TITLE"
    confirm-label="Sign release"
    confirm-severity="warn"
    :confirm-disabled="!agreed"
    @update:visible="(v) => emit('update:visible', v)"
    @confirm="(dataUrl) => emit('confirm', dataUrl)"
  >
    <div
      class="rounded-md border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] px-3 py-2.5"
    >
      <p class="text-sm font-semibold text-[color:var(--bs-warning-text)]">
        <i class="pi pi-shield mr-1"></i>Blue Seal isn't covered by your policy
      </p>
      <ul class="mt-2 space-y-1.5">
        <li
          v-for="point in INSURANCE_RELEASE_POINTS"
          :key="point"
          class="flex items-start gap-2 text-xs text-[color:var(--bs-warning-text)]"
        >
          <i class="pi pi-check text-[0.65rem] mt-0.5"></i>
          <span>{{ point }}</span>
        </li>
      </ul>
    </div>

    <label class="mt-3 flex items-start gap-2 text-sm text-[color:var(--bs-text)]">
      <Checkbox v-model="agreed" binary :disabled="props.busy" />
      <span>{{ INSURANCE_RELEASE_CHECKBOX }}</span>
    </label>

    <template #below-canvas>
      <p class="mt-2 text-[0.7rem] leading-snug text-[color:var(--bs-muted)]">
        {{ INSURANCE_RELEASE_FOOTNOTE }}
      </p>
    </template>
  </BaseSignatureDialog>
</template>
