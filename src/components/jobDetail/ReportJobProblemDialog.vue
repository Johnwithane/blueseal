<script setup lang="ts">
// "Report a problem with this job" — opens a support ticket routed to the admin
// support queue, tagged with the jobId so it lands with job context instead of
// the generic Help form (P2-15). A curated intake, not the Stripe-chargeback
// `disputes` collection (that's webhook-owned).
import { ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import Message from "primevue/message";
import { createSupportTicket } from "@/firebase/services/support";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  visible: boolean;
  jobId: string;
  jobTitle: string;
}>();
const emit = defineEmits<{ "update:visible": [value: boolean] }>();

const auth = useAuthStore();
const toast = useToast();
const message = ref("");
const submitting = ref(false);

// Reset the message each time the dialog opens.
watch(
  () => props.visible,
  (open) => {
    if (open) message.value = "";
  },
);

async function submit() {
  if (message.value.trim().length < 5 || submitting.value) return;
  submitting.value = true;
  try {
    await createSupportTicket({
      name: auth.user?.displayName?.trim() || auth.fbUser?.email?.split("@")[0] || "Client",
      email: auth.fbUser?.email ?? "",
      topic: "A problem with a job",
      message: `Re: ${props.jobTitle} (job ${props.jobId})\n\n${message.value.trim()}`,
      jobId: props.jobId,
    });
    toast.success("Thanks — we're on it", "Our support team will look into this and follow up by email.");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Report a problem with this job"
    :style="{ width: '32rem', maxWidth: '92vw' }"
    @update:visible="emit('update:visible', $event)"
  >
    <p class="text-sm text-[color:var(--bs-muted)] mb-3">
      Tell us what's wrong and our support team will look into it. We'll reply to
      {{ auth.fbUser?.email ?? "your account email" }}.
    </p>
    <Textarea
      v-model="message"
      rows="5"
      class="w-full"
      maxlength="2000"
      placeholder="What happened? Include anything that helps us understand the issue."
    />
    <Message v-if="!auth.fbUser?.email" severity="warn" :closable="false" class="mt-2 text-xs">
      Your account has no email on file, so we may not be able to reply. Add one in Account first.
    </Message>
    <template #footer>
      <Button label="Cancel" text :disabled="submitting" @click="emit('update:visible', false)" />
      <Button
        label="Send to support"
        icon="pi pi-send"
        :loading="submitting"
        :disabled="message.trim().length < 5"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
