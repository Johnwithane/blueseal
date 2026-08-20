<script setup lang="ts">
// The job's Quote tab. Owns fetching the tradesperson's rate + hydrating from
// an existing quote (resend/edit), and calls submitQuote with the composer's
// payload. The editor itself lives in QuoteComposer (shared with the
// marketplace apply form).
//
// This was a modal (QuoteSheet) until issues #19 + #22: a full-width sticky
// "Prepare quote" CTA plus a blocking dialog made quoting read as a required
// step, when the backend has allowed invoicing with no quote at all since
// PR #15. As a tab it sits beside Brief / Schedule / Work order / Invoice —
// available, not demanded — and the "skip the quote" card below points at the
// invoice-without-quote path the reporter couldn't find.
import { computed, onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import { submitQuote, getQuoteByJobId } from "@/firebase/services/quotes";
import { getSiteVisit, proposeSiteVisit } from "@/firebase/services/siteVisits";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { draftQuoteWithAi } from "@/firebase/services/aiDrafts";
import { useAuthStore } from "@/stores/auth";
import { usePaywallStore } from "@/stores/paywall";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { useConfirmAction } from "@/composables/useConfirmAction";
import { useInsuranceGate } from "@/composables/useInsuranceGate";
import { humanizeError } from "@/utils/errors";
import QuoteComposer from "@/components/QuoteComposer.vue";
import type {
  QuoteComposerInitial,
  QuoteComposerSection,
  QuoteComposerState,
} from "@/components/QuoteComposer.vue";
import SiteVisitForm from "@/components/SiteVisitForm.vue";
import type { SiteVisitFormState } from "@/components/SiteVisitForm.vue";
import type { JobStatus } from "@/firebase/interfaces";

const props = defineProps<{
  jobId: string;
  /** Job status, so the tab can explain what state the quote is in. */
  status: JobStatus;
  /** An agreed site visit gets its fee pre-filled into the first quote. */
  siteVisitAgreedNote?: string | null;
}>();

const emit = defineEmits<{
  /** A quote or site-visit request went out — parent reloads the job. */
  submitted: [];
  /** Jump to another tab (the "skip the quote" path). */
  "go-tab": [key: string];
}>();

const { money } = useFormatters();
const toast = useToast();
const auth = useAuthStore();
const paywall = usePaywallStore();
const insuranceGate = useInsuranceGate();

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

// How the tradesperson wants to price this job. Asked FIRST, before any form:
// most jobs are simply "my hourly rate plus whatever parts cost", and making
// everyone build an itemized scope for that was the main complaint about the
// quote flow. null = the chooser is still on screen.
//   "tm"       — one hourly line + an optional materials estimate, on a short form.
//   "itemized" — the full guided walkthrough (unchanged).
type QuoteStyle = "tm" | "itemized";
const quoteStyle = ref<QuoteStyle | null>(null);
// Escape hatch out of the short T&M form into every option (discount, upfront
// fee, validity, terms) without starting over.
const tmShowAll = ref(false);

// Guided walkthrough for a FRESH quote: the composer's sections are revealed
// one step at a time, ending on the full form to review & send. Resends skip
// it (the tradie is tweaking, not building) and "Skip" drops straight to the
// form. State lives in the one composer instance, so nothing is lost between
// steps.
const WIZARD_STEPS: { title: string; hint: string; sections: QuoteComposerSection[] }[] = [
  {
    title: "Scope of work",
    hint: "Add what you'll do — hourly time, flat-rate work, materials.",
    sections: ["items"],
  },
  {
    title: "Timing",
    hint: "When you can start, how long it'll take, and how long the quote stands.",
    sections: ["timing", "validity"],
  },
  {
    title: "Money details",
    hint: "Optional — ask for an upfront fee, or add a discount.",
    sections: ["upfront", "discount"],
  },
  {
    title: "Note & terms",
    hint: "A short cover note, anything excluded from the price, and your total so far.",
    sections: ["notes", "summary"],
  },
];
const wizardStep = ref<number | null>(null);
const inWizard = computed(
  () => mode.value === "quote" && quoteStyle.value === "itemized" && wizardStep.value !== null,
);

// The short form still needs timing + a note + the running total — it drops the
// optional money machinery (discount, upfront fee, validity), which is what
// made the standard flow feel heavy for a rate-and-parts job.
const TM_SECTIONS: QuoteComposerSection[] = ["items", "timing", "notes", "summary"];

const wizardSections = computed<QuoteComposerSection[] | null>(() => {
  if (inWizard.value) return WIZARD_STEPS[wizardStep.value as number].sections;
  if (quoteStyle.value === "tm" && !tmShowAll.value) return TM_SECTIONS;
  return null;
});

// Seed the T&M form so there's nothing to assemble: an hourly line at their
// profile rate, and a materials line they can price or delete. quantity/unitPrice
// are the stored LineItem shape (hours × cents-per-hour for an hourly line).
function chooseTimeAndMaterials() {
  quoteStyle.value = "tm";
  tmShowAll.value = false;
  wizardStep.value = null;
  const existingLines = initial.value?.lineItems ?? [];
  initial.value = {
    ...(initial.value ?? {}),
    lineItems: [
      ...existingLines,
      {
        kind: "hourly",
        description: "Labour",
        quantity: 0,
        unitPrice: hourlyRateCents.value ?? 0,
        taxRate: 0,
      },
      {
        kind: "materials",
        description: "Materials",
        quantity: 1,
        unitPrice: 0,
        taxRate: 0,
      },
    ],
  };
}

function chooseItemized() {
  quoteStyle.value = "itemized";
  wizardStep.value = 0;
}

function chooseSiteVisit() {
  mode.value = "site_visit";
  quoteStyle.value = "itemized"; // so the chooser doesn't reappear behind the form
  wizardStep.value = null;
}

// Back to the three cards. Line items typed so far survive in the composer;
// only the presentation changes.
function reopenChooser() {
  mode.value = "quote";
  quoteStyle.value = null;
  wizardStep.value = null;
}

function wizardNext() {
  const i = wizardStep.value;
  if (i === null) return;
  // The scope step is the only must-have — don't walk forward with nothing to bill.
  if (i === 0 && !composer.value?.valid) {
    attempted.value = true;
    toast.error(
      "Add the work first",
      composer.value?.issues[0] ?? "Add at least one line item with an amount.",
    );
    return;
  }
  wizardStep.value = i + 1 >= WIZARD_STEPS.length ? null : i + 1;
}
function wizardBack() {
  // Back off the first step returns to the approach chooser rather than
  // dead-ending — the wizard is no longer the start of the flow.
  if (wizardStep.value === 0) reopenChooser();
  else if (wizardStep.value) wizardStep.value -= 1;
}
function wizardSkip() {
  wizardStep.value = null;
}

// AI draft: builds a starting quote from the job details + chat. Replaces the
// current rows (after a confirm when something's already typed) — the
// tradesperson reviews every line before sending. Free today; routed through
// the server-side entitlement seam slated for Blue Seal Pro.
const { confirmDestructive } = useConfirmAction();
const drafting = ref(false);

function onDraftWithAi() {
  if (drafting.value) return;
  if ((composer.value?.totals.subtotal ?? 0) > 0) {
    confirmDestructive(
      {
        message:
          "Replace your current line items with an AI draft? What you've typed will be overwritten.",
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
    const draft = await draftQuoteWithAi({ jobId: props.jobId });
    initial.value = {
      lineItems: draft.lineItems,
      terms: draft.terms,
      noteToClient: draft.noteToClient,
      estimatedDuration: draft.estimatedDuration,
    };
    toast.success("Draft ready", "Prices are AI estimates — review every line before sending.");
  } catch (e) {
    if (paywall.fromError(e)) return;
    toast.error("Couldn't draft the quote", humanizeError(e));
  } finally {
    drafting.value = false;
  }
}
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

// Fetch the rate + any existing quote, set the composer seed, THEN mount the
// composer (gated on !loading) so it hydrates once with correct data. As a tab
// this runs on mount and again after a successful send (the job has moved on,
// so the form should come back as a resend of what just went out).
async function loadQuote() {
    loading.value = true;
    isResend.value = false;
    priorDeclinedReason.value = null;
    initial.value = null;
    composer.value = null;
    attempted.value = false;
    mode.value = "quote";
    quoteStyle.value = null;
    tmShowAll.value = false;
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
    // Resend/edit → straight to the full form (the tradie is tweaking, not
    // building). A fresh quote starts on the "how do you want to quote this?"
    // chooser, which then sets the style + wizard step.
    if (existing) {
      quoteStyle.value = "itemized";
      tmShowAll.value = true;
    }
    wizardStep.value = null;
    loading.value = false;
}
onMounted(loadQuote);
// The tab is kept mounted across job reloads; if the parent swaps to a
// different job, start over.
watch(() => props.jobId, loadQuote);

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
  // Soft nudge: if there's no proof of insurance on file, remind before
  // sending — they can get covered or continue.
  if (!(await insuranceGate.ensureInsuredOrConfirm())) return;
  submitting.value = true;
  try {
    await submitQuote({ jobId: props.jobId, ...s.payload });
    toast.success(
      isResend.value ? "Quote re-sent" : "Quote sent",
      "Your client has been notified.",
    );
    emit("submitted");
    // No dialog to close — reload so the tab shows what was just sent.
    await loadQuote();
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
    await loadQuote();
  } catch (e) {
    toast.error("Couldn't request site visit", humanizeError(e));
  } finally {
    submitting.value = false;
  }
}

// Whether a quote is still the natural next step. Past "quoted" the client has
// already acted on it, so the tab explains rather than nags.
const quoteIsOpen = computed(() => props.status === "requested" || props.status === "quoted");
</script>

<template>
  <section class="quote-tab">
    <header class="mb-3">
      <h3 class="font-semibold">{{ isResend ? "Revise quote" : "Prepare a quote" }}</h3>
      <p class="mt-0.5 text-xs text-[color:var(--bs-muted)]">
        <template v-if="quoteIsOpen">
          Optional. You can send an invoice without ever quoting.
        </template>
        <template v-else>
          This job is past the quoting stage — anything you send now replaces the quote on file.
        </template>
      </p>
    </header>

    <!-- Moved off the old sticky CTA bar: an agreed visit fee is pre-filled
         into the first quote, which is only worth saying next to the form. -->
    <p
      v-if="siteVisitAgreedNote"
      class="mb-3 rounded-lg bg-[color:var(--bs-info-tint)] px-3 py-2 text-xs text-[color:var(--bs-info-text)]"
    >
      <i class="pi pi-map-marker mr-1"></i>{{ siteVisitAgreedNote }}
    </p>

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
            <div class="font-semibold text-sm text-[color:var(--bs-warning-text)]">
              Client's request
            </div>
            <p class="text-sm text-[color:var(--bs-warning-text)] mt-1 whitespace-pre-wrap">
              {{ priorDeclinedReason }}
            </p>
          </div>
        </div>
      </div>

      <!-- START HERE on a fresh quote: pick how to price the job before any
           form appears. Time & materials is first because it's the common case
           — a rate and some parts, not an itemized scope. -->
      <div v-if="quoteStyle === null" class="space-y-2">
        <h4 class="font-semibold">How do you want to quote this?</h4>
        <p class="text-xs text-[color:var(--bs-muted)] mb-2">
          You can change your mind at any point — nothing you've typed is lost.
        </p>
        <button type="button" class="quote-style-card" @click="chooseTimeAndMaterials">
          <i class="pi pi-clock quote-style-card__icon"></i>
          <span class="min-w-0">
            <span class="block font-semibold text-sm">Time &amp; materials</span>
            <span class="block text-xs text-[color:var(--bs-muted)] leading-snug">
              Your hourly rate
              <template v-if="hourlyRateCents">({{ money(hourlyRateCents) }}/hr)</template>
              plus an optional materials estimate. Quickest way to send something.
            </span>
          </span>
          <i class="pi pi-chevron-right text-xs opacity-50"></i>
        </button>
        <button type="button" class="quote-style-card" @click="chooseItemized">
          <i class="pi pi-list quote-style-card__icon"></i>
          <span class="min-w-0">
            <span class="block font-semibold text-sm">Itemized quote</span>
            <span class="block text-xs text-[color:var(--bs-muted)] leading-snug">
              Build the scope line by line, with discounts, an upfront fee and terms. Guided, four
              short steps.
            </span>
          </span>
          <i class="pi pi-chevron-right text-xs opacity-50"></i>
        </button>
        <button
          v-if="canRequestVisit"
          type="button"
          class="quote-style-card"
          @click="chooseSiteVisit"
        >
          <i class="pi pi-map-marker quote-style-card__icon"></i>
          <span class="min-w-0">
            <span class="block font-semibold text-sm">Site visit first</span>
            <span class="block text-xs text-[color:var(--bs-muted)] leading-snug">
              Can't price it blind? Ask to see the job first, with an optional callout fee.
            </span>
          </span>
          <i class="pi pi-chevron-right text-xs opacity-50"></i>
        </button>
      </div>

      <!-- Change-approach link, once a path is chosen on a fresh quote. -->
      <button
        v-if="quoteStyle !== null && !isResend"
        type="button"
        class="mb-3 text-xs text-[color:var(--bs-blue)] underline"
        @click="reopenChooser"
      >
        ← Change how you're quoting
      </button>

      <!-- Wizard chrome: step counter, skip link, title + progress. -->
      <div v-if="inWizard" class="mb-4">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-[color:var(--bs-muted)]">
            Step {{ (wizardStep ?? 0) + 1 }} of {{ WIZARD_STEPS.length }}
          </span>
          <button
            type="button"
            class="text-xs text-[color:var(--bs-blue)] underline"
            @click="wizardSkip"
          >
            Skip — fill out the full form
          </button>
        </div>
        <h4 class="font-semibold mt-1">{{ WIZARD_STEPS[wizardStep!].title }}</h4>
        <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
          {{ WIZARD_STEPS[wizardStep!].hint }}
        </p>
        <div class="mt-2 flex gap-1" aria-hidden="true">
          <span
            v-for="i in WIZARD_STEPS.length"
            :key="i"
            class="h-1 flex-1 rounded-full"
            :class="
              i - 1 <= wizardStep! ? 'bg-[color:var(--bs-blue)]' : 'bg-[color:var(--bs-border)]'
            "
          ></span>
        </div>
      </div>

      <!-- AI draft — on the scope step (or the full form), where the rows land. -->
      <div
        v-if="quoteStyle !== null && mode === 'quote' && (!inWizard || wizardStep === 0)"
        class="mb-4 flex items-center gap-2"
      >
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
          Builds a starting quote from the job details and chat — you review every line.
        </span>
      </div>

      <SiteVisitForm
        v-if="quoteStyle !== null && mode === 'site_visit'"
        @update:state="(s) => (siteVisitForm = s)"
      />
      <QuoteComposer
        v-else-if="quoteStyle !== null"
        :hourly-rate-cents="hourlyRateCents"
        :initial="initial"
        :show-errors="attempted"
        :visible-sections="wizardSections"
        @update:state="(s) => (composer = s)"
      />

      <!-- T&M keeps the optional money machinery out of the way until asked. -->
      <button
        v-if="quoteStyle === 'tm' && mode === 'quote' && !tmShowAll"
        type="button"
        class="mt-3 text-xs text-[color:var(--bs-blue)] underline"
        @click="tmShowAll = true"
      >
        Show every option (discount, upfront fee, validity, terms)
      </button>
    </template>

    <!-- Actions. On a tab these sit at the end of the flow rather than in a
         dialog footer; the chooser step has nothing to send yet, so it has
         no action row at all. -->
    <div v-if="!loading && quoteStyle !== null" class="quote-tab__actions">
      <!-- Wizard: Back / Next. The send button only appears on the review form. -->
      <div v-if="inWizard" class="flex w-full items-center gap-2">
        <Button label="Back" icon="pi pi-arrow-left" text @click="wizardBack" />
        <span class="flex-1"></span>
        <Button
          :label="wizardStep === WIZARD_STEPS.length - 1 ? 'Review & send' : 'Next'"
          icon="pi pi-arrow-right"
          icon-pos="right"
          @click="wizardNext"
        />
      </div>
      <div v-else class="flex w-full">
        <Button
          :label="submitLabel"
          icon="pi pi-send"
          :loading="submitting"
          :disabled="submitting"
          class="w-full sm:w-auto"
          @click="onSubmit"
        />
      </div>
    </div>

    <!-- The reporter's actual ask (#19): make the no-quote path findable.
         The backend has allowed it since PR #15 — nothing pointed at it. -->
    <button
      v-if="!loading && quoteIsOpen"
      type="button"
      class="quote-tab__skip"
      @click="emit('go-tab', 'invoice')"
    >
      <i class="pi pi-receipt quote-tab__skip-icon"></i>
      <span class="min-w-0 text-left">
        <span class="block text-sm font-semibold">Skip the quote — invoice directly</span>
        <span class="block text-xs leading-snug text-[color:var(--bs-muted)]">
          No quote or tracked time needed. Write the invoice yourself on the Invoice tab.
        </span>
      </span>
      <i class="pi pi-chevron-right text-xs opacity-50"></i>
    </button>
  </section>
</template>

<style>
/* Approach chooser cards. Full-width tap targets — this is the first thing a
   tradesperson sees on a phone when a quote is due. */
.quote-style-card {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.75rem;
  min-height: 64px;
  padding: 0.75rem;
  text-align: left;
  border: 1px solid var(--bs-border);
  border-radius: 0.75rem;
  background: var(--bs-surface);
  transition:
    border-color 0.15s,
    background-color 0.15s;
}
.quote-style-card:hover,
.quote-style-card:focus-visible {
  border-color: var(--bs-blue);
  background: var(--bs-surface-alt);
}
.quote-style-card__icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  background: var(--bs-info-tint);
  color: var(--bs-blue);
  font-size: 0.9rem;
}

/* Action row. Sticks to the bottom of the viewport on a phone the way the old
   dialog footer did, so "Send quote" stays reachable in a long itemized form
   without scrolling to the end. `bottom` clears the app's bottom nav. */
.quote-tab__actions {
  position: sticky;
  bottom: 0;
  z-index: 1;
  margin-top: 1rem;
  padding: 0.75rem 0;
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
  border-top: 1px solid var(--bs-border);
  background: var(--bs-surface);
}

/* "Skip the quote" — deliberately below the send action and quieter than the
   approach cards: an escape hatch, not a competing primary path. */
.quote-tab__skip {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
  padding: 0.75rem;
  text-align: left;
  border: 1px dashed var(--bs-border);
  border-radius: 0.75rem;
  background: transparent;
  transition:
    border-color 0.15s,
    background-color 0.15s;
}
.quote-tab__skip:hover,
.quote-tab__skip:focus-visible {
  border-color: var(--bs-blue);
  background: var(--bs-surface-alt);
}
.quote-tab__skip-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  background: var(--bs-surface-alt);
  color: var(--bs-muted);
  font-size: 0.9rem;
}
</style>
