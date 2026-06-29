<script setup lang="ts">
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import Button from "primevue/button";

// Shared "reject with a reason" dialog. ApplicationReviewView had four
// byte-identical reject dialogs (cert / ID / insurance / WSIB) differing only
// in header + handler (UI_UX_AUDIT.md admin #5). This owns the markup; callers
// bind their visible + reason refs and supply the confirm handler.
//
// Optional props let it also express the job-board "decline applicant" dialog
// (DeclineApplicationDialog is now a thin wrapper): quick-pick chips, a busy
// state, a custom confirm label/icon, fullscreen-on-mobile styling, and an
// #intro slot above the chips. When omitted, behaviour is identical to before.
const props = withDefaults(
  defineProps<{
    visible: boolean;
    reason: string;
    header: string;
    busy?: boolean;
    canned?: string[];
    confirmLabel?: string;
    confirmIcon?: string;
    fullscreenMobile?: boolean;
    placeholder?: string;
    rows?: string | number;
    maxlength?: string | number;
  }>(),
  {
    busy: false,
    canned: undefined,
    confirmLabel: "Reject",
    confirmIcon: "pi pi-ban",
    fullscreenMobile: false,
    placeholder: "Reason for rejection",
    rows: 4,
    maxlength: 2000,
  },
);

const emit = defineEmits<{
  "update:visible": [value: boolean];
  "update:reason": [value: string];
  confirm: [];
}>();

function close() {
  if (props.busy) return;
  emit("update:visible", false);
}

function confirm() {
  if (props.busy) return;
  emit("confirm");
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="header"
    :closable="!busy"
    :draggable="!fullscreenMobile"
    :style="fullscreenMobile ? undefined : { width: '32rem', maxWidth: '92vw' }"
    :pt="fullscreenMobile ? { root: { class: 'reject-reason-dialog--fullscreen' } } : undefined"
    @update:visible="$emit('update:visible', $event)"
  >
    <slot name="intro" />

    <div v-if="canned" class="flex flex-wrap gap-2 mt-3">
      <button
        v-for="c in canned"
        :key="c"
        type="button"
        class="reject-reason-dialog__chip"
        @click="$emit('update:reason', c)"
      >
        {{ c }}
      </button>
    </div>

    <Textarea
      :model-value="reason"
      :rows="rows"
      class="w-full"
      :class="{ 'mt-3': canned }"
      :placeholder="placeholder"
      :maxlength="maxlength"
      autofocus
      @update:model-value="$emit('update:reason', $event ?? '')"
    />
    <template #footer>
      <div
        v-if="fullscreenMobile"
        class="flex flex-col-reverse gap-2 w-full sm:flex-row sm:items-center"
      >
        <Button
          label="Cancel"
          text
          :disabled="busy"
          class="w-full sm:w-auto"
          @click="close"
        />
        <span class="hidden flex-1 sm:block"></span>
        <Button
          :label="confirmLabel"
          :icon="confirmIcon"
          severity="danger"
          :loading="busy"
          :disabled="!reason.trim() || busy"
          class="w-full sm:w-auto"
          @click="confirm"
        />
      </div>
      <template v-else>
        <Button label="Cancel" text :disabled="busy" @click="close" />
        <Button
          :label="confirmLabel"
          :icon="confirmIcon"
          severity="danger"
          :loading="busy"
          :disabled="!reason.trim() || busy"
          @click="confirm"
        />
      </template>
    </template>
  </Dialog>
</template>

<style>
.reject-reason-dialog--fullscreen {
  width: 100vw;
  max-width: 480px;
  margin: 0;
}
.reject-reason-dialog__chip {
  font-size: 0.8rem;
  border-radius: 9999px;
  border: 1px solid var(--bs-border);
  background: white;
  padding: 0.35rem 0.75rem;
  min-height: 36px;
  color: var(--bs-text);
}
.reject-reason-dialog__chip:hover {
  border-color: var(--bs-blue);
  background: rgba(89, 176, 224, 0.08);
}
.reject-reason-dialog--fullscreen .p-dialog-footer {
  border-top: 1px solid var(--bs-border);
  padding-top: 0.75rem;
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}
@media (max-width: 639px) {
  .reject-reason-dialog--fullscreen {
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
}
</style>
