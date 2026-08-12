<script setup lang="ts">
// Solo-mode (bring-your-own-client) counterpart of ClientQuoteApprovalBanner:
// the job is quoted but there is no client on Blue Seal to accept, so the
// tradesperson can record an acceptance their client gave outside the app
// (verbally, by text). Explicit attestation checkbox, no signature ever, and
// the copy is up-front that the job won't earn reviews.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Checkbox from "primevue/checkbox";
import { recordOfflineQuoteAcceptance, subscribeQuote } from "@/firebase/services/quotes";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import type { QuoteDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  jobId: string;
}>();

const emit = defineEmits<{
  recorded: [];
}>();

const toast = useToast();
const { money } = useFormatters();

const quote = ref<WithId<QuoteDoc> | null>(null);
let unsubQuote: (() => void) | null = null;
onMounted(() => {
  unsubQuote = subscribeQuote(props.jobId, (q) => {
    quote.value = q;
  });
});
onBeforeUnmount(() => unsubQuote?.());

// Only actionable while the quote is awaiting the client (sent/viewed) —
// mirrors ClientQuoteApprovalBanner's gate.
const actionable = computed(() => {
  const s = quote.value?.status;
  return s === "sent" || s === "viewed";
});

const showDialog = ref(false);
const attested = ref(false);
const submitting = ref(false);

async function record() {
  if (submitting.value || !attested.value) return;
  submitting.value = true;
  try {
    await recordOfflineQuoteAcceptance(props.jobId);
    toast.success(
      "Acceptance recorded",
      "The job is now active — track time and invoice as usual.",
    );
    showDialog.value = false;
    emit("recorded");
  } catch (e) {
    toast.error("Couldn't record acceptance", humanizeError(e));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="actionable" class="bs-card p-4 border-l-4 border-l-[color:var(--bs-blue)]">
    <div class="flex items-start gap-3">
      <i class="pi pi-check-square text-[color:var(--bs-blue)] text-lg mt-0.5"></i>
      <div class="min-w-0 flex-1">
        <div class="font-semibold">Did your client accept this quote?</div>
        <!-- Deliberately says "hasn't joined", not "isn't on Blue Seal": the
             invited address may well belong to an existing account that simply
             hasn't accepted the invite. Claiming otherwise reads as a bug. -->
        <p class="text-sm text-[color:var(--bs-muted)] mt-1">
          Your client hasn't joined this job on Blue Seal yet. If they've agreed to the quote
          (verbally, by text, in person), record it here to start the job.
        </p>
        <Button
          label="Record client acceptance"
          icon="pi pi-check"
          size="small"
          class="mt-3"
          @click="showDialog = true"
        />
      </div>
    </div>

    <Dialog
      v-model:visible="showDialog"
      modal
      header="Record offline acceptance"
      class="w-[92vw] max-w-md"
    >
      <p v-if="quote" class="text-sm">
        Quote <strong>{{ quote.quoteNumber }}</strong> —
        <strong>{{ money(quote.total) }}</strong>
        <template v-if="quote.upfrontFee && quote.upfrontFee.amountCents > 0">
          (includes a {{ money(quote.upfrontFee.amountCents) }} upfront fee due before work starts)
        </template>
      </p>
      <p class="text-sm text-[color:var(--bs-muted)] mt-2">
        This is recorded as <em>accepted by you on your client's behalf</em> — no in-app signature.
        It will appear in the job log, and your client will see it if they join later. Jobs accepted
        this way don't earn Blue Seal reviews.
      </p>
      <label class="flex items-start gap-2 mt-4 text-sm">
        <Checkbox v-model="attested" binary />
        <span>I confirm my client accepted this quote outside Blue Seal.</span>
      </label>
      <div class="flex gap-2 mt-4">
        <Button label="Cancel" text class="flex-1" @click="showDialog = false" />
        <Button
          label="Record acceptance"
          icon="pi pi-check"
          class="flex-1"
          :disabled="!attested"
          :loading="submitting"
          @click="record"
        />
      </div>
    </Dialog>
  </div>
</template>
