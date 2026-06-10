<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import {
  clientAcceptQuote,
  clientDeclineQuote,
  subscribeQuote,
} from "@/firebase/services/quotes";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import StatusBanner from "@/components/StatusBanner.vue";
import QuoteSignatureDialog from "@/components/QuoteSignatureDialog.vue";
import type { QuoteDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  jobId: string;
}>();

const emit = defineEmits<{
  decided: [];
}>();

const toast = useToast();
const { money } = useFormatters();
const accepting = ref(false);
const declining = ref(false);

const showDeclineDialog = ref(false);
const reason = ref("");
const showSignDialog = ref(false);

// Live subscription to the quote doc. The parent renders this banner
// when job.status === "quoted", but clientDeclineQuote deliberately
// leaves job.status unchanged (so the tradie can revise without the
// kanban moving). Without a separate gate on quote.status, declining
// the banner just reloads the same accept/decline prompt on every
// future visit until the tradie resubmits — visible bug. We hide the
// action banner whenever the latest quote is "declined" / "withdrawn"
// / "expired", and replace it with a "waiting on the tradesperson"
// stub so the client knows the ball is in the other court.
const quote = ref<WithId<QuoteDoc> | null>(null);
let unsubQuote: (() => void) | null = null;

onMounted(() => {
  unsubQuote = subscribeQuote(props.jobId, (q) => {
    quote.value = q;
  });
});
onBeforeUnmount(() => unsubQuote?.());

const showActions = computed(() => {
  // Default to actionable when the quote hasn't loaded yet — the
  // parent's `job.status === "quoted"` gate is already a precondition,
  // and a flash of the awaiting-state would be more confusing than a
  // flash of the action state.
  if (!quote.value) return true;
  return quote.value.status === "sent" || quote.value.status === "viewed";
});

// Upfront-fee snapshot from the live quote. Drives the "$X required
// before work starts" copy on the accept button so the client understands
// they're committing to a deposit before the tradesperson picks up tools.
const upfrontFeeCents = computed<number>(() => {
  const fee = quote.value?.upfrontFee;
  return fee && fee.amountCents > 0 ? fee.amountCents : 0;
});

// Accepting now requires a signature: the button opens the signature pad, and
// the actual callable fires from onSignedAccept once the client has drawn +
// confirmed. `accepting` drives the dialog's Confirm spinner.
function onAccept() {
  if (accepting.value || declining.value) return;
  showSignDialog.value = true;
}

async function onSignedAccept(signatureDataUrl: string) {
  if (accepting.value) return;
  accepting.value = true;
  try {
    await clientAcceptQuote(props.jobId, signatureDataUrl);
    toast.success(
      "Quote accepted",
      "Your tradesperson has been notified — they'll reach out to schedule.",
    );
    showSignDialog.value = false;
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
  <StatusBanner
    v-if="showActions"
    severity="action"
    icon="pi-file"
    title="You've got a quote to review"
  >
    <template #body>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        Read through the breakdown below. Accept to lock it in and let the
        tradesperson schedule, or ask to discuss if anything needs changing.
      </p>
      <div
        v-if="upfrontFeeCents > 0"
        class="mt-2 rounded-md border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] px-3 py-2 text-xs text-[color:var(--bs-warning-text)]"
      >
        <i class="pi pi-wallet text-[color:var(--bs-warning-text)] mr-1"></i>
        Accepting commits you to pay
        <span class="font-semibold">{{ money(upfrontFeeCents) }}</span>
        upfront before work begins. It'll be credited against the final invoice.
      </div>
    </template>
    <template #actions>
      <div class="grid sm:grid-cols-2 gap-2">
        <Button
          label="Discuss / change"
          icon="pi pi-comments"
          severity="secondary"
          outlined
          :disabled="accepting || declining"
          @click="openDeclineDialog"
        />
        <Button
          :label="upfrontFeeCents > 0 ? `Accept — ${money(upfrontFeeCents)} upfront` : 'Accept quote'"
          icon="pi pi-check"
          severity="success"
          :loading="accepting"
          :disabled="accepting || declining"
          @click="onAccept"
        />
      </div>
    </template>
  </StatusBanner>

  <!-- Awaiting-tradesperson stub. Shown when the client has already
       declined / the quote has expired or been withdrawn — keeps the
       client from seeing the same actionable banner on every revisit
       while the tradesperson preps a revision. -->
  <StatusBanner
    v-else
    severity="waiting"
    icon="pi-hourglass"
    :title="quote?.status === 'declined' ? 'Waiting on a revised quote' : 'Quote pending'"
  >
    <template #body>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        <template v-if="quote?.status === 'declined'">
          Your feedback has been sent. The tradesperson will tweak the quote
          and send it back — you'll see a new accept/decline prompt here when
          it arrives.
        </template>
        <template v-else-if="quote?.status === 'expired'">
          This quote's validity period passed. Ping the tradesperson in the
          chat to ask for a fresh one.
        </template>
        <template v-else-if="quote?.status === 'withdrawn'">
          The tradesperson pulled this quote back. Check the chat for context.
        </template>
        <template v-else>
          Waiting for the next step from the tradesperson.
        </template>
      </p>
    </template>
  </StatusBanner>

  <!-- Decline / discuss dialog. Rendered at the template root — NOT inside the
       v-else awaiting stub — so it's mounted in both states. The "Discuss /
       change" trigger lives in the v-if actionable banner above, so a dialog
       nested in the v-else would never mount when that trigger is visible. -->
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

  <!-- Signature sign-off. Mounted at the root (like the decline dialog) so it's
       available in both banner states. Drawing + confirming here is what fires
       clientAcceptQuote. -->
  <QuoteSignatureDialog
    v-model:visible="showSignDialog"
    :quote-total="quote?.total"
    :upfront-fee-cents="upfrontFeeCents"
    :busy="accepting"
    @confirm="onSignedAccept"
  />
</template>
