<script setup lang="ts">
import { ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import SignatureCanvas from "@/components/SignatureCanvas.vue";
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

const sig = ref<InstanceType<typeof SignatureCanvas> | null>(null);
const isEmpty = ref(true);
const agreed = ref(false);

// Re-arm the checkbox each open so a previous session can't carry through.
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
    :header="TRADIE_WAIVER_TITLE"
    :pt="{ root: { class: 'sign-dialog' } }"
    @update:visible="(v) => emit('update:visible', v)"
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
      <span>Get insured in minutes with {{ INSURANCE_PARTNER.name }}</span>
      <i class="pi pi-external-link ml-auto text-[0.72rem] opacity-70" aria-hidden="true"></i>
    </a>

    <label class="mt-3 flex items-start gap-2 text-sm text-[color:var(--bs-text)]">
      <Checkbox v-model="agreed" binary :disabled="props.busy" />
      <span>{{ TRADIE_WAIVER_CHECKBOX }}</span>
    </label>

    <div class="mt-3">
      <SignatureCanvas ref="sig" @update:empty="(v) => (isEmpty = v)" />
    </div>

    <p class="mt-2 text-[0.7rem] leading-snug text-[color:var(--bs-muted)]">
      {{ TRADIE_WAIVER_FOOTNOTE }}
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
          label="Sign &amp; start"
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
/* Self-contained copy of the signature-dialog sizing (mirrors
   QuoteSignatureDialog) so this dialog stands alone if that one isn't loaded. */
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
