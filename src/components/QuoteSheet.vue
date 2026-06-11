<script setup lang="ts">
// Dialog wrapper around QuoteComposer for the direct-request quote flow. Owns
// fetching the tradesperson's rate + hydrating from an existing quote
// (resend/edit), and calls submitQuote with the composer's payload. The
// editor itself lives in QuoteComposer (shared with the marketplace apply form).
import { computed, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import { submitQuote, getQuoteByJobId } from "@/firebase/services/quotes";
import { getSiteVisit, proposeSiteVisit } from "@/firebase/services/siteVisits";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { useAuthStore } from "@/stores/auth";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import QuoteComposer from "@/components/QuoteComposer.vue";
import type { QuoteComposerInitial, QuoteComposerState } from "@/components/QuoteComposer.vue";
import SiteVisitForm from "@/components/SiteVisitForm.vue";
import type { SiteVisitFormState } from "@/components/SiteVisitForm.vue";

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

// "quote" = build a full quote (default). "site_visit" = ask to see the job
// first, with an optional fee. The toggle only shows on a fresh quote with no
// visit already proposed/agreed.
const mode = ref<"quote" | "site_visit">("quote");
const siteVisitForm = ref<SiteVisitFormState | null>(null);
const existingVisitStatus = ref<string | null>(null);
const canRequestVisit = computed(() => !isResend.value && existingVisitStatus.value === null);

// Deliberately NOT gated on validity — a dead disabled button gives no clue
// what's missing. Submit stays clickable; an invalid attempt flips `attempted`
// so the composer renders every blocking issue inline.
const attempted = ref(false);
const submitLabel = computed(() => {
  if (mode.value === "site_visit") {
    const fee = siteVisitForm.value?.fee.feeCents ?? 0;
    return fee > 0 ? `Request site visit — ${money(fee)}` : "Request a free site visit";
  }
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
    attempted.value = false;
    mode.value = "quote";
    siteVisitForm.value = null;
    existingVisitStatus.value = null;
    try {
      const uid = auth.fbUser?.uid;
      hourlyRateCents.value = uid ? ((await getTradesperson(uid))?.hourlyRate ?? null) : null;
    } catch {
      hourlyRateCents.value = null;
    }
    // Fetch any existing quote (resend) and any site-visit agreement in parallel.
    const [existing, visit] = await Promise.all([
      getQuoteByJobId(props.jobId).catch(() => null),
      getSiteVisit(props.jobId).catch(() => null),
    ]);
    existingVisitStatus.value = visit?.status ?? null;
    // Pre-fill an AGREED visit fee as a line item, but only on the first quote
    // (no existing quote) so a resend doesn't double-seed it. The tradesperson
    // keeps it (charge on top) or deletes it (waive/credit) — no auto-credit.
    const seededLines: QuoteComposerInitial["lineItems"] =
      !existing && visit?.status === "agreed"
        ? [
            {
              kind: "labour",
              description: visit.fee.description,
              quantity: 1,
              unitPrice: visit.fee.feeCents,
              taxRate: visit.fee.taxRate,
            },
          ]
        : undefined;
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
        // Stored at UTC midnight — format in UTC to get the original date back.
        proposedStartDate: existing.proposedStartDate
          ? existing.proposedStartDate.toDate().toISOString().slice(0, 10)
          : null,
        estimatedDuration: existing.estimatedDuration ?? "",
      };
    } else if (seededLines) {
      initial.value = { lineItems: seededLines };
    }
    loading.value = false;
  },
);

async function onSubmit() {
  if (mode.value === "site_visit") {
    await onRequestVisit();
    return;
  }
  const s = composer.value;
  if (!s || !s.valid || !s.payload) {
    attempted.value = true;
    toast.error(
      "Quote isn't ready to send",
      s?.issues[0] ?? "Add at least one line item with an amount.",
    );
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

async function onRequestVisit() {
  const sv = siteVisitForm.value;
  if (!sv || !sv.valid) {
    toast.error("Add a short label", "Tell the client what the visit is for.");
    return;
  }
  submitting.value = true;
  try {
    await proposeSiteVisit({
      jobId: props.jobId,
      fee: sv.fee,
      proposedDate: sv.proposedDate,
      note: sv.note,
    });
    toast.success("Site visit requested", "Your client has been notified to agree.");
    emit("submitted");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't request site visit", humanizeError(e));
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
        class="rounded-lg border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] p-3 mb-4"
      >
        <div class="flex items-start gap-2">
          <i class="pi pi-info-circle text-[color:var(--bs-warning)] mt-0.5"></i>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-sm text-[color:var(--bs-warning-text)]">Client's request</div>
            <p class="text-sm text-[color:var(--bs-warning-text)] mt-1 whitespace-pre-wrap">{{ priorDeclinedReason }}</p>
          </div>
        </div>
      </div>

      <!-- Mode toggle: full quote vs "site visit first". Only on a fresh quote
           with no visit already in flight. -->
      <div
        v-if="canRequestVisit"
        class="flex rounded-lg border border-[color:var(--bs-border)] p-1 mb-4 text-sm"
      >
        <button
          type="button"
          class="flex-1 rounded-md py-2 px-3 font-medium transition-colors"
          :class="mode === 'quote' ? 'bg-[color:var(--bs-brand)] text-white' : 'text-[color:var(--bs-muted)]'"
          @click="mode = 'quote'"
        >
          Send a quote
        </button>
        <button
          type="button"
          class="flex-1 rounded-md py-2 px-3 font-medium transition-colors"
          :class="mode === 'site_visit' ? 'bg-[color:var(--bs-brand)] text-white' : 'text-[color:var(--bs-muted)]'"
          @click="mode = 'site_visit'"
        >
          Site visit first
        </button>
      </div>

      <SiteVisitForm
        v-if="mode === 'site_visit'"
        @update:state="(s) => (siteVisitForm = s)"
      />
      <QuoteComposer
        v-else
        :hourly-rate-cents="hourlyRateCents"
        :initial="initial"
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
