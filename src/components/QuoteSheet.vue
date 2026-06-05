<script setup lang="ts">
// Dialog wrapper around QuoteComposer for the direct-request quote flow. Owns
// fetching the tradesperson's rate + hydrating from an existing quote
// (resend/edit), and calls submitQuote with the composer's payload. The
// editor itself lives in QuoteComposer (shared with the marketplace apply form).
import { computed, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import { submitQuote, getQuoteByJobId } from "@/firebase/services/quotes";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { useAuthStore } from "@/stores/auth";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import QuoteComposer from "@/components/QuoteComposer.vue";
import type { QuoteComposerInitial, QuoteComposerState } from "@/components/QuoteComposer.vue";

const props = defineProps<{
  visible: boolean;
  jobId: string;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  submitted: [];
}>();

const { money } = useFormatters();
const toast = useToast();
const auth = useAuthStore();

const submitting = ref(false);
const loading = ref(false);
const isResend = ref(false);
const priorDeclinedReason = ref<string | null>(null);
const hourlyRateCents = ref<number | null>(null);
const initial = ref<QuoteComposerInitial | null>(null);
const composer = ref<QuoteComposerState | null>(null);

const canSubmit = computed(() => !submitting.value && !!composer.value?.valid);
const submitLabel = computed(() => {
  const s = composer.value;
  if (s && s.totals.total > 0) {
    return isResend.value
      ? `Re-send quote — ${money(s.totals.total)}`
      : `Send quote — ${money(s.totals.total)}`;
  }
  return s?.hasIncompleteLine ? "Add a description to each line" : "Add a line to bill first";
});

// On open: fetch the rate + any existing quote, set the composer seed, THEN
// mount the composer (gated on !loading) so it hydrates once with correct data.
watch(
  () => props.visible,
  async (v) => {
    if (!v) return;
    loading.value = true;
    isResend.value = false;
    priorDeclinedReason.value = null;
    initial.value = null;
    composer.value = null;
    try {
      const uid = auth.fbUser?.uid;
      hourlyRateCents.value = uid ? ((await getTradesperson(uid))?.hourlyRate ?? null) : null;
    } catch {
      hourlyRateCents.value = null;
    }
    try {
      const existing = await getQuoteByJobId(props.jobId);
      if (existing) {
        isResend.value = true;
        priorDeclinedReason.value = existing.declinedReason ?? null;
        initial.value = {
          lineItems: existing.lineItems ?? [],
          discount: existing.discount ?? null,
          terms: existing.terms ?? "",
          noteToClient: existing.noteToClient ?? "",
          estimatedHours: existing.estimatedHours ?? null,
          upfrontFee: existing.upfrontFee ?? null,
        };
      }
    } catch {
      /* fresh form */
    } finally {
      loading.value = false;
    }
  },
);

async function onSubmit() {
  const s = composer.value;
  if (!s || !s.valid || !s.payload) {
    if (s?.hasHourlyLineWithoutRate) {
      toast.error(
        "Hourly line is missing a rate",
        "Set a profile rate, override the rate on that line, or switch it to Flat rate.",
      );
      return;
    }
    toast.error("Add at least one line", "A quote needs something to bill.");
    return;
  }
  submitting.value = true;
  try {
    await submitQuote({ jobId: props.jobId, ...s.payload });
    toast.success(
      isResend.value ? "Quote re-sent" : "Quote sent",
      "Your client has been notified.",
    );
    emit("submitted");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't send quote", humanizeError(e));
  } finally {
    submitting.value = false;
  }
}

function close() {
  if (submitting.value) return;
  emit("update:visible", false);
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :closable="!submitting"
    :dismissable-mask="false"
    :draggable="false"
    :header="isResend ? 'Revise quote' : 'Prepare quote'"
    :pt="{ root: { class: 'quote-sheet-dialog' } }"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <div v-if="loading" class="py-10 text-center text-sm text-[color:var(--bs-muted)]">
      <i class="pi pi-spin pi-spinner text-xl block mb-2"></i>
      Loading…
    </div>

    <template v-else>
      <!-- Prior decline reason — surfaces what the client asked to change -->
      <div
        v-if="priorDeclinedReason"
        class="rounded-lg border border-amber-300 bg-amber-50 p-3 mb-4"
      >
        <div class="flex items-start gap-2">
          <i class="pi pi-info-circle text-amber-600 mt-0.5"></i>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-sm text-amber-900">Client's request</div>
            <p class="text-sm text-amber-900 mt-1 whitespace-pre-wrap">{{ priorDeclinedReason }}</p>
          </div>
        </div>
      </div>

      <QuoteComposer
        :hourly-rate-cents="hourlyRateCents"
        :initial="initial"
        @update:state="(s) => (composer = s)"
      />
    </template>

    <template #footer>
      <div class="flex flex-col-reverse gap-2 w-full sm:flex-row sm:items-center">
        <Button label="Cancel" text :disabled="submitting" class="w-full sm:w-auto" @click="close" />
        <span class="hidden flex-1 sm:block"></span>
        <Button
          :label="submitLabel"
          icon="pi pi-send"
          :loading="submitting"
          :disabled="!canSubmit"
          class="w-full sm:w-auto"
          @click="onSubmit"
        />
      </div>
    </template>
  </Dialog>
</template>

<style>
.quote-sheet-dialog {
  width: 100vw;
  max-width: 640px;
  margin: 0;
  display: flex;
  flex-direction: column;
}
.quote-sheet-dialog .p-dialog-content {
  overflow-y: auto;
  flex: 1 1 auto;
}
.quote-sheet-dialog .p-dialog-footer {
  border-top: 1px solid var(--bs-border);
  background: white;
  padding: 0.75rem 1rem;
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}
@media (max-width: 639px) {
  .quote-sheet-dialog {
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
}
</style>
