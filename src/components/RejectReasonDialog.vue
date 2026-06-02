<script setup lang="ts">
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import Button from "primevue/button";

// Shared "reject with a reason" dialog. ApplicationReviewView had four
// byte-identical reject dialogs (cert / ID / insurance / WSIB) differing only
// in header + handler (UI_UX_AUDIT.md admin #5). This owns the markup; callers
// bind their visible + reason refs and supply the confirm handler.
defineProps<{
  visible: boolean;
  reason: string;
  header: string;
}>();

defineEmits<{
  "update:visible": [value: boolean];
  "update:reason": [value: string];
  confirm: [];
}>();
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="header"
    :style="{ width: '32rem', maxWidth: '92vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <Textarea
      :model-value="reason"
      rows="4"
      class="w-full"
      placeholder="Reason for rejection"
      maxlength="2000"
      autofocus
      @update:model-value="$emit('update:reason', $event ?? '')"
    />
    <template #footer>
      <Button label="Cancel" text @click="$emit('update:visible', false)" />
      <Button
        label="Reject"
        icon="pi pi-ban"
        severity="danger"
        :disabled="!reason.trim()"
        @click="$emit('confirm')"
      />
    </template>
  </Dialog>
</template>
