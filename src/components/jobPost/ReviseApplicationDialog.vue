<script setup lang="ts">
// Dialog for a tradesperson to revise the quote on an existing pending
// application (the negotiation outcome). Mirrors QuoteSheet: owns the hourly
// rate + hydrates QuoteComposer from the current application quote, then calls
// reviseApplication. Surfaces the client's decline reason if there was one.
import { computed, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import { reviseApplication } from "@/firebase/services/applications";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { draftQuoteWithAi } from "@/firebase/services/aiDrafts";
import { useAuthStore } from "@/stores/auth";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { useConfirmAction } from "@/composables/useConfirmAction";
import { humanizeError } from "@/utils/errors";
import { reviseApplicationSchema } from "@/validation/schemas";
import QuoteComposer from "@/components/QuoteComposer.vue";
import type { QuoteComposerInitial, QuoteComposerState } from "@/components/QuoteComposer.vue";
import type { ApplicationDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  visible: boolean;
  postId: string;
  application: WithId<ApplicationDoc>;
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
const hourlyRateCents = ref<number | null>(null);
const initial = ref<QuoteComposerInitial | null>(null);
const composer = ref<QuoteComposerState | null>(null);

const declinedReason = computed(() => props.application.declinedReason ?? null);

// A chat-first application has no quote yet — this dialog is then the FIRST
// send, not a revision (the callable flips kind to "full" either way).
const isFirstQuote = computed(() => !props.application.quote);

// Submit stays clickable when invalid — a failed attempt flips `attempted` so
// the composer renders every blocking issue inline (mirrors QuoteSheet).
const attempted = ref(false);
const submitLabel = computed(() => {
  const s = composer.value;
  if (s && s.totals.total > 0) {
    return `${isFirstQuote.value ? "Send" : "Re-send"} quote — ${money(s.totals.total)}`;
  }
  return s?.hasIncompleteLine ? "Add a description to each line" : "Add a line to bill first";
});

watch(
  () => props.visible,
  async (v) => {
    if (!v) return;
    loading.value = true;
    initial.value = null;
    composer.value = null;
    attempted.value = false;
    try {
      const uid = auth.fbUser?.uid;
      hourlyRateCents.value = uid ? ((await getTradesperson(uid))?.hourlyRate ?? null) : null;
    } catch {
      hourlyRateCents.value = null;
    }
    const q = props.application.quote;
    if (q) {
      initial.value = {
        lineItems: q.lineItems ?? [],
        discount: q.discount ?? null,
        terms: q.terms ?? "",
        noteToClient: q.noteToClient ?? "",
        estimatedHours: q.estimatedHours ?? null,
        upfrontFee: q.upfrontFee ?? null,
        // Stored at UTC midnight — format in UTC to recover the original date.
        proposedStartDate: q.proposedStartDate
          ? q.proposedStartDate.toDate().toISOString().slice(0, 10)
          : null,
        estimatedDuration: q.estimatedDuration ?? "",
      };
    }
    loading.value = false;
  },
);

async function onSubmit() {
  const s = composer.value;
  if (!s || !s.valid || !s.payload) {
    attempted.value = true;
    toast.error(
      "Quote isn't ready to send",
      s?.issues[0] ?? "Add at least one line item with an amount.",
    );
    return;
  }
  const parsed = reviseApplicationSchema.safeParse({
    postId: props.postId,
    quote: s.payload,
    proposedStartDate: s.payload.proposedStartDate,
  });
  if (!parsed.success) {
    toast.error("Check the quote", parsed.error.issues[0]?.message ?? "Something's off.");
    return;
  }
  submitting.value = true;
  try {
    await reviseApplication(parsed.data);
    toast.success(
      isFirstQuote.value ? "Quote sent" : "Quote updated",
      isFirstQuote.value
        ? "The client can now compare and accept your quote."
        : "The client has been notified of your revised quote.",
    );
    emit("submitted");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't revise quote", humanizeError(e));
  } finally {
    submitting.value = false;
  }
}

function close() {
  if (submitting.value) return;
  emit("update:visible", false);
}

// AI draft from the post + this application's Q&A thread — the payoff of a
// chat-first application is that those answers feed the draft. Replaces the
// current rows after a confirm. Free today; behind the server-side
// entitlement seam slated for Blue Seal Pro.
const { confirmDestructive } = useConfirmAction();
const drafting = ref(false);

function onDraftWithAi() {
  if (drafting.value) return;
  if ((composer.value?.totals.subtotal ?? 0) > 0) {
    confirmDestructive(
      {
        message: "Replace the current line items with an AI draft? What's there will be overwritten.",
        header: "Draft with AI",
        acceptLabel: "Replace",
      },
      runDraft,
    );
  } else {
    void runDraft();
  }
}

async function runDraft() {
  drafting.value = true;
  try {
    const draft = await draftQuoteWithAi({ postId: props.postId });
    initial.value = {
      lineItems: draft.lineItems,
      terms: draft.terms,
      noteToClient: draft.noteToClient,
      estimatedDuration: draft.estimatedDuration,
    };
    toast.success("Draft ready", "Prices are AI estimates — review every line before sending.");
  } catch (e) {
    toast.error("Couldn't draft the quote", humanizeError(e));
  } finally {
    drafting.value = false;
  }
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :closable="!submitting"
    :dismissable-mask="false"
    :draggable="false"
    :header="isFirstQuote ? 'Send your quote' : 'Revise quote'"
    :pt="{ root: { class: 'revise-app-dialog' } }"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <div v-if="loading" class="py-10 text-center text-sm text-[color:var(--bs-muted)]">
      <i class="pi pi-spin pi-spinner text-xl block mb-2"></i>
      Loading…
    </div>

    <template v-else>
      <div
        v-if="declinedReason"
        class="rounded-lg border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] p-3 mb-4"
      >
        <div class="flex items-start gap-2">
          <i class="pi pi-info-circle text-[color:var(--bs-warning)] mt-0.5"></i>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-sm text-[color:var(--bs-warning-text)]">Client's request</div>
            <p class="text-sm text-[color:var(--bs-warning-text)] mt-1 whitespace-pre-wrap">{{ declinedReason }}</p>
          </div>
        </div>
      </div>

      <div class="mb-4 flex items-center gap-2">
        <Button
          label="Draft with AI"
          icon="pi pi-sparkles"
          outlined
          size="small"
          :loading="drafting"
          :disabled="drafting"
          @click="onDraftWithAi"
        />
        <span class="text-[11px] leading-snug text-[color:var(--bs-muted)]">
          Builds a quote from the post and your messages with the client.
        </span>
      </div>

      <QuoteComposer
        :hourly-rate-cents="hourlyRateCents"
        :initial="initial"
        hide-note
        :show-errors="attempted"
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
          :disabled="submitting"
          class="w-full sm:w-auto"
          @click="onSubmit"
        />
      </div>
    </template>
  </Dialog>
</template>

<style>
.revise-app-dialog {
  width: 100vw;
  max-width: 640px;
  margin: 0;
  display: flex;
  flex-direction: column;
}
.revise-app-dialog .p-dialog-content {
  overflow-y: auto;
  flex: 1 1 auto;
}
.revise-app-dialog .p-dialog-footer {
  border-top: 1px solid var(--bs-border);
  background: white;
  padding: 0.75rem 1rem;
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}
@media (max-width: 639px) {
  .revise-app-dialog {
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
}
</style>
