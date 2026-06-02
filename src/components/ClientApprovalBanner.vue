<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import { clientApproveJob, clientRequestChanges } from "@/firebase/services/jobs";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import StatusBanner from "@/components/StatusBanner.vue";

const props = defineProps<{
  jobId: string;
}>();

const emit = defineEmits<{
  decided: [];
}>();

const toast = useToast();
const approving = ref(false);
const requesting = ref(false);

const showRequestDialog = ref(false);
const reason = ref("");

async function onApprove() {
  if (approving.value) return;
  approving.value = true;
  try {
    await clientApproveJob(props.jobId);
    toast.success(
      "Approved",
      "The invoice has been sent. Pay using the instructions on the invoice.",
    );
    emit("decided");
  } catch (e) {
    toast.error("Couldn't approve", humanizeError(e));
  } finally {
    approving.value = false;
  }
}

function openRequestDialog() {
  reason.value = "";
  showRequestDialog.value = true;
}

async function onSubmitRequest() {
  const text = reason.value.trim();
  if (!text) {
    toast.error("Please add a short note so the tradesperson knows what to change.");
    return;
  }
  if (requesting.value) return;
  requesting.value = true;
  try {
    await clientRequestChanges(props.jobId, text);
    toast.success("Sent back to the tradesperson", "They'll see your note in chat.");
    showRequestDialog.value = false;
    emit("decided");
  } catch (e) {
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    requesting.value = false;
  }
}
</script>

<template>
  <StatusBanner severity="action" icon="pi-check-circle" title="Please review the work">
    <template #body>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        Your tradesperson marked the job as done. Look over the invoice below.
        Approve to receive it and pay, or request changes if anything's off.
      </p>
    </template>
    <template #actions>
      <div class="grid sm:grid-cols-2 gap-2">
        <Button
          label="Request changes"
          icon="pi pi-undo"
          severity="secondary"
          outlined
          :disabled="approving || requesting"
          @click="openRequestDialog"
        />
        <Button
          label="Approve & receive invoice"
          icon="pi pi-check"
          severity="success"
          :loading="approving"
          :disabled="approving || requesting"
          @click="onApprove"
        />
      </div>
    </template>
  </StatusBanner>

  <Dialog
      v-model:visible="showRequestDialog"
      modal
      header="Request changes"
      :style="{ width: '30rem', maxWidth: '92vw' }"
    >
      <p class="text-sm text-[color:var(--bs-text)] mb-3">
        Tell the tradesperson what you'd like adjusted. They'll see this in the
        job chat and can fix it before re-sending.
      </p>
      <Textarea
        v-model="reason"
        rows="4"
        class="w-full"
        :maxlength="1000"
        placeholder="e.g. The drain still leaks, please come back. Or — please remove the extra hour, you were here for 2."
        autofocus
      />
      <template #footer>
        <Button label="Cancel" text :disabled="requesting" @click="showRequestDialog = false" />
        <Button
          label="Send request"
          icon="pi pi-send"
          severity="warn"
          :loading="requesting"
          :disabled="requesting"
          @click="onSubmitRequest"
        />
      </template>
    </Dialog>
</template>
