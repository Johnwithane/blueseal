<script setup lang="ts">
import { ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import SignatureCanvas from "@/components/SignatureCanvas.vue";

// Shared shell for every "draw a signature to agree" dialog. Owns the bits that
// are identical across all of them — the PrimeVue <Dialog>, the <SignatureCanvas>
// ref + empty state, the Clear/Cancel/Confirm footer, and the open/close reset so
// a stale signature never carries between sessions. Each concrete dialog stays a
// thin wrapper that supplies its own header/body/extra-controls via slots and
// gates Confirm with `confirmDisabled` (e.g. a parent acknowledgment checkbox).
//
// Pure capture: on Confirm it extracts the drawn data URL and emits it; the
// wrapper/parent owns the network call and drives the spinner via `busy`.
const props = withDefaults(
  defineProps<{
    visible: boolean;
    busy?: boolean;
    header: string;
    confirmLabel?: string;
    confirmSeverity?: "success" | "warn" | "info" | "danger";
    // When true the dialog can't be dismissed (no X, no Esc) — used for the
    // blocking first-login rep agreement gate.
    blocking?: boolean;
    // Extra gate ANDed with the signature-empty check, so a wrapper's checkbox
    // can keep Confirm disabled until acknowledged.
    confirmDisabled?: boolean;
    // Hide the Cancel button (agreement dialogs commit/close another way).
    cancelable?: boolean;
    // Override the PrimeVue Dialog root class. Defaults to the shared
    // full-screen-on-mobile sign-dialog sheet; the wider agreement dialogs pass
    // their own width class instead.
    dialogClass?: string;
  }>(),
  {
    busy: false,
    confirmLabel: "Agree & sign",
    confirmSeverity: "success",
    blocking: false,
    confirmDisabled: false,
    cancelable: true,
    dialogClass: "sign-dialog",
  },
);

const emit = defineEmits<{
  "update:visible": [v: boolean];
  confirm: [dataUrl: string];
}>();

const sig = ref<InstanceType<typeof SignatureCanvas> | null>(null);
const isEmpty = ref(true);

// Reset the canvas whenever the dialog opens or closes so a previously drawn
// signature can never persist into a new session.
watch(
  () => props.visible,
  () => {
    sig.value?.clear();
  },
);

function onConfirm() {
  if (isEmpty.value || props.busy || props.confirmDisabled) return;
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
    :closable="!props.blocking && !props.busy"
    :close-on-escape="!props.blocking"
    :header="props.header"
    :pt="{ root: { class: props.dialogClass } }"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <slot />

    <div class="mt-3">
      <SignatureCanvas ref="sig" @update:empty="(v) => (isEmpty = v)" />
    </div>

    <slot name="below-canvas" />

    <template #footer>
      <div :class="['flex items-center gap-2 w-full', { 'justify-end': !props.cancelable }]">
        <Button
          label="Clear"
          text
          icon="pi pi-eraser"
          :disabled="isEmpty || props.busy"
          @click="sig?.clear()"
        />
        <template v-if="props.cancelable">
          <span class="flex-1"></span>
          <Button
            label="Cancel"
            text
            :disabled="props.busy"
            @click="emit('update:visible', false)"
          />
        </template>
        <Button
          :label="props.confirmLabel"
          icon="pi pi-check"
          :severity="props.confirmSeverity"
          :loading="props.busy"
          :disabled="isEmpty || props.busy || props.confirmDisabled"
          @click="onConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<style>
/* Compact sheet on desktop, full-height on mobile for a large touch target —
   mirrors the PdfPreviewDialog pattern. Lives here as the single source for the
   shared signature-dialog sizing now that every signing surface wraps this. */
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
