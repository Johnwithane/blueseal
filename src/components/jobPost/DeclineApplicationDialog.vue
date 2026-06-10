<script setup lang="ts">
// Reason dialog for declining a job-board applicant. The reason is sent to the
// tradesperson (so they know what to change before re-applying) and the card
// leaves the client's active list. Full-screen on mobile, like QuoteSheet.
import { ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import Textarea from "primevue/textarea";

const props = defineProps<{
  visible: boolean;
  applicantName: string;
  busy?: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  confirm: [reason: string];
}>();

const reason = ref("");

// Reset the field each time the dialog opens.
watch(
  () => props.visible,
  (v) => {
    if (v) reason.value = "";
  },
);

const CANNED = [
  "Quote is over budget",
  "Timeline doesn't work",
  "Chose another applicant",
  "Scope has changed",
];

function pick(c: string) {
  reason.value = c;
}

function confirm() {
  const r = reason.value.trim();
  if (!r || props.busy) return;
  emit("confirm", r);
}

function close() {
  if (props.busy) return;
  emit("update:visible", false);
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :closable="!props.busy"
    :dismissable-mask="false"
    :draggable="false"
    header="Decline this applicant"
    :pt="{ root: { class: 'decline-app-dialog' } }"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <p class="text-sm text-[color:var(--bs-muted)]">
      Tell {{ props.applicantName }} why you're passing — they'll see this and can
      revise their quote if it's something they can change.
    </p>

    <div class="flex flex-wrap gap-2 mt-3">
      <button
        v-for="c in CANNED"
        :key="c"
        type="button"
        class="decline-app-dialog__chip"
        @click="pick(c)"
      >
        {{ c }}
      </button>
    </div>

    <Textarea
      v-model="reason"
      rows="3"
      maxlength="1000"
      placeholder="e.g. The materials line pushes this past our budget — could you trim it?"
      class="mt-3 w-full"
    />

    <template #footer>
      <div class="flex flex-col-reverse gap-2 w-full sm:flex-row sm:items-center">
        <Button label="Cancel" text :disabled="props.busy" class="w-full sm:w-auto" @click="close" />
        <span class="hidden flex-1 sm:block"></span>
        <Button
          label="Decline applicant"
          icon="pi pi-times"
          severity="danger"
          :loading="props.busy"
          :disabled="!reason.trim() || props.busy"
          class="w-full sm:w-auto"
          @click="confirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<style>
.decline-app-dialog {
  width: 100vw;
  max-width: 480px;
  margin: 0;
}
.decline-app-dialog__chip {
  font-size: 0.8rem;
  border-radius: 9999px;
  border: 1px solid var(--bs-border);
  background: white;
  padding: 0.35rem 0.75rem;
  min-height: 36px;
  color: var(--bs-text);
}
.decline-app-dialog__chip:hover {
  border-color: var(--bs-blue);
  background: rgba(89, 176, 224, 0.08);
}
.decline-app-dialog .p-dialog-footer {
  border-top: 1px solid var(--bs-border);
  padding-top: 0.75rem;
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}
@media (max-width: 639px) {
  .decline-app-dialog {
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
}
</style>
