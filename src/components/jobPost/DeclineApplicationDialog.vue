<script setup lang="ts">
// Reason dialog for declining a job-board applicant. The reason is sent to the
// tradesperson (so they know what to change before re-applying) and the card
// leaves the client's active list. Full-screen on mobile, like QuoteSheet.
//
// Thin wrapper over the shared RejectReasonDialog — it owns the local reason
// ref (reset each time the dialog opens) and maps to the same public contract
// this component has always had.
import { ref, watch } from "vue";
import RejectReasonDialog from "@/components/RejectReasonDialog.vue";

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

function confirm() {
  const r = reason.value.trim();
  if (!r || props.busy) return;
  emit("confirm", r);
}
</script>

<template>
  <RejectReasonDialog
    v-model:reason="reason"
    :visible="props.visible"
    header="Decline this applicant"
    :canned="CANNED"
    :busy="props.busy"
    confirm-label="Decline applicant"
    confirm-icon="pi pi-times"
    fullscreen-mobile
    :rows="3"
    :maxlength="1000"
    placeholder="e.g. The materials line pushes this past our budget — could you trim it?"
    @update:visible="(v) => emit('update:visible', v)"
    @confirm="confirm"
  >
    <template #intro>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Tell {{ props.applicantName }} why you're passing — they'll see this and can
        revise their quote if it's something they can change.
      </p>
    </template>
  </RejectReasonDialog>
</template>
