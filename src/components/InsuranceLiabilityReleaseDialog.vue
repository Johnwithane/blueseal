<script setup lang="ts">
import { ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import SignatureCanvas from "@/components/SignatureCanvas.vue";
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

const sig = ref<InstanceType<typeof SignatureCanvas> | null>(null);
const isEmpty = ref(true);
const agreed = ref(false);

watch(
  () => props.visible,
  (v) => {
    if (v) agreed.value = false;
  },
);

function onConfirm() {
  if (isEmpty.value || props.busy || !agreed.value) return;
  const dataUrl = sig.value?.extract() ?? "";
  if (!dataUrl) return;
  emit("confirm", dataUrl);
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :draggable="false"
    :closable="!props.busy"
    :header="INSURANCE_RELEASE_TITLE"
    :pt="{ root: { class: 'sign-dialog' } }"
    @update:visible="(v) => emit('update:visible', v)"
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

    <div class="mt-3">
      <SignatureCanvas ref="sig" @update:empty="(v) => (isEmpty = v)" />
    </div>

    <p class="mt-2 text-[0.7rem] leading-snug text-[color:var(--bs-muted)]">
      {{ INSURANCE_RELEASE_FOOTNOTE }}
    </p>

    <template #footer>
      <div class="flex items-center gap-2 w-full">
        <Button
          label="Clear"
          text
          icon="pi pi-eraser"
          :disabled="isEmpty || props.busy"
          @click="sig?.clear()"
        />
        <span class="flex-1"></span>
        <Button label="Cancel" text :disabled="props.busy" @click="emit('update:visible', false)" />
        <Button
          label="Sign release"
          icon="pi pi-check"
          severity="warn"
          :loading="props.busy"
          :disabled="isEmpty || props.busy || !agreed"
          @click="onConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<style>
/* Self-contained copy of the signature-dialog sizing (mirrors the other
   signature dialogs) so this dialog stands alone if they aren't loaded. */
.sign-dialog {
  width: 100vw;
  max-width: 420px;
  margin: 0;
}
.sign-dialog .p-dialog-footer {
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}
@media (max-width: 639px) {
  .sign-dialog {
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
}
</style>
