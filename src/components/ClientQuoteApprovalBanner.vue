<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import { clientAcceptQuote, clientDeclineQuote } from "@/firebase/services/quotes";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  jobId: string;
}>();

const emit = defineEmits<{
  decided: [];
}>();

const toast = useToast();
const accepting = ref(false);
const declining = ref(false);

const showDeclineDialog = ref(false);
const reason = ref("");

async function onAccept() {
  if (accepting.value) return;
  accepting.value = true;
  try {
    await clientAcceptQuote(props.jobId);
    toast.success(
      "Quote accepted",
      "Your tradesperson has been notified — they'll reach out to schedule.",
    );
    emit("decided");
  } catch (e) {
    toast.error("Couldn't accept", humanizeError(e));
  } finally {
    accepting.value = false;
  }
}

function openDeclineDialog() {
  reason.value = "";
  showDeclineDialog.value = true;
}

async function onSubmitDecline() {
  const text = reason.value.trim();
  if (!text) {
    toast.error("Please add a short note so the tradesperson knows what's up.");
    return;
  }
  if (declining.value) return;
  declining.value = true;
  try {
    await clientDeclineQuote(props.jobId, text);
    toast.success(
      "Sent",
      "Your tradesperson can revise the quote and re-send.",
    );
    showDeclineDialog.value = false;
    emit("decided");
  } catch (e) {
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    declining.value = false;
  }
}
</script>

<template>
  <div class="bs-card p-4 border-l-4 border-l-amber-500">
    <div class="flex items-start gap-3">
      <i class="pi pi-file text-amber-600 text-xl mt-0.5"></i>
      <div class="min-w-0 flex-1">
        <div class="font-semibold text-base">You've got a quote to review</div>
        <p class="text-sm text-[color:var(--bs-muted)] mt-1">
          Read through the breakdown below. Accept to lock it in and let the
          tradesperson schedule, or ask to discuss if anything needs changing.
        </p>
      </div>
    </div>

    <div class="grid sm:grid-cols-2 gap-2 mt-4">
      <Button
        label="Discuss / change"
        icon="pi pi-comments"
        severity="secondary"
        outlined
        :disabled="accepting || declining"
        @click="openDeclineDialog"
      />
      <Button
        label="Accept quote"
        icon="pi pi-check"
        severity="success"
        :loading="accepting"
        :disabled="accepting || declining"
        @click="onAccept"
      />
    </div>

    <Dialog
      v-model:visible="showDeclineDialog"
      modal
      header="Discuss the quote"
      :style="{ width: '30rem', maxWidth: '92vw' }"
    >
      <p class="text-sm text-[color:var(--bs-text)] mb-3">
        What would you like to change or talk through? The tradesperson sees this
        in the chat and can send a revised quote.
      </p>
      <Textarea
        v-model="reason"
        rows="4"
        class="w-full"
        :maxlength="1000"
        placeholder="e.g. Can we swap the premium fixture for a standard one? Or — the price looks high for the scope, can we discuss?"
        autofocus
      />
      <template #footer>
        <Button label="Cancel" text :disabled="declining" @click="showDeclineDialog = false" />
        <Button
          label="Send"
          icon="pi pi-send"
          severity="warn"
          :loading="declining"
          :disabled="declining"
          @click="onSubmitDecline"
        />
      </template>
    </Dialog>
  </div>
</template>
