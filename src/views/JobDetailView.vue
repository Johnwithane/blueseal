<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Avatar from "primevue/avatar";
import DatePicker from "primevue/datepicker";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import Dialog from "primevue/dialog";
import {
  CANCELLABLE_STATUSES,
  cancelJob,
  getJob,
  markJobPaid,
  scheduleJob,
  updateJobStatus,
  updatePrivateNotes,
  saveJobIntakeAndAdvance,
} from "@/firebase/services/jobs";
import { returnToApplicants } from "@/firebase/services/jobPosts";
import { updateJobLog } from "@/firebase/services/assistant";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { findCollisions, type Collision } from "@/firebase/services/bookings";
import { useConfirm } from "primevue/useconfirm";
import { getInvoiceByJobId } from "@/firebase/services/invoices";
import { useAuthStore } from "@/stores/auth";
import type { JobDoc, JobStatus, TradespersonDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import ChatThread from "@/components/ChatThread.vue";
import IntakeFormRenderer from "@/components/IntakeFormRenderer.vue";
import InvoiceEditor from "@/components/InvoiceEditor.vue";
import ReviewPrompt from "@/components/ReviewPrompt.vue";
import TimeTrackerCard from "@/components/TimeTrackerCard.vue";
import ExpensesCard from "@/components/ExpensesCard.vue";
import FinishJobSheet from "@/components/FinishJobSheet.vue";
import ClientApprovalBanner from "@/components/ClientApprovalBanner.vue";
import QuoteSheet from "@/components/QuoteSheet.vue";
import QuoteCard from "@/components/QuoteCard.vue";
import ClientQuoteApprovalBanner from "@/components/ClientQuoteApprovalBanner.vue";
import { SEED_INTAKE_SCHEMAS } from "@/data/intakeSchemas";
import { getIntakeSchema } from "@/firebase/services/intakeFormSchemas";
import type { IntakeField } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const confirmDialog = useConfirm();
const { date, dateTime } = useFormatters();

const job = ref<WithId<JobDoc> | null>(null);
const tradieInfo = ref<WithId<TradespersonDoc> | null>(null);
const intakeFields = ref<IntakeField[]>([]);
const invoiceId = ref<string | null>(null);
const loading = ref(true);
// When the URL points at a job the signed-in user can't read (notification
// pointing at a stale or wrong id, deep link from another account) the
// service throws permission-denied. Catch it here so the view shows a
// useful empty state instead of hanging on "Loading…" forever.
const loadError = ref<string | null>(null);

const scheduledStart = ref<Date | null>(null);
const scheduledEnd = ref<Date | null>(null);
const privateNotes = ref("");

// AI auto-log state. Manual trigger forces a Vertex call even if the
// server's 1-hour cooldown hasn't elapsed; auto-trigger on mount lets the
// server short-circuit silently.
const updatingLog = ref(false);

// Marketplace-originated jobs land in status="accepted". The client completes
// the trade intake here before the standard flow begins.
const intakeDraft = ref<Record<string, unknown>>({});
const savingIntake = ref(false);
const returningToApplicants = ref(false);

// Client-side cancellation state. The button + dialog are visible to the
// client only while the job is in a cancellable status — once work starts
// or money is owed, cancellation goes through a dispute (not built yet).
const showCancelDialog = ref(false);
const cancelReason = ref("");
const cancelling = ref(false);

// Schedule-collision state. Set when saveSchedule detects an overlap;
// the dialog gives the tradie the choice to schedule anyway (e.g. they
// just want to override their own block-off) or pick a different time.
const collisions = ref<Collision[]>([]);
const showCollisionDialog = ref(false);
const savingSchedule = ref(false);

// Finish-job wrap-up sheet (tradie only, in_progress only). Opens via the
// sticky bottom CTA. Submit posts to submitJobForApproval — the sheet
// itself handles state + toasts; we just re-load on success.
const showFinishSheet = ref(false);
// Mark-paid action (tradie only, awaiting_payment only). Routes through
// the markJobPaid callable which atomically flips invoice → paid AND job
// → complete so the two never drift.
const markingPaid = ref(false);
// Quote-prep sheet (tradie only, requested/quoted). Same sticky-CTA slot
// as Finish-job — they're mutually exclusive by status.
const showQuoteSheet = ref(false);

// Status set that surfaces the sticky bottom CTA on mobile. Drives both
// the bottom padding on the section (so content isn't hidden behind the
// fixed bar) and the bar's visibility.
const stickyCTAStatuses: ReadonlySet<JobStatus> = new Set([
  "requested",
  "quoted",
  "in_progress",
]);
const showStickyCTA = computed(
  () => job.value != null && isTradie.value && stickyCTAStatuses.has(job.value.status),
);

// AI log button: floats over the page for the tradesperson on any
// still-active job (i.e. not done or cancelled). When the sticky CTA is
// also showing, the FAB sits above it; otherwise it pins to the page
// bottom. Inactive statuses skip it — once the work is closed out there
// is no new client activity worth summarising.
const AI_FAB_INACTIVE: ReadonlySet<JobStatus> = new Set([
  "complete",
  "reviewed",
  "cancelled",
]);
const showAiFab = computed(
  () => job.value != null && isTradie.value && !AI_FAB_INACTIVE.has(job.value.status),
);

const statusOptions: { label: string; value: JobStatus }[] = [
  { label: "Accepted", value: "accepted" },
  { label: "Requested", value: "requested" },
  { label: "Quoted", value: "quoted" },
  { label: "Quote accepted", value: "quote_accepted" },
  { label: "Scheduled", value: "scheduled" },
  { label: "In progress", value: "in_progress" },
  { label: "Awaiting approval", value: "awaiting_client_approval" },
  { label: "Awaiting payment", value: "awaiting_payment" },
  { label: "Complete", value: "complete" },
  { label: "Cancelled", value: "cancelled" },
];

const isTradie = computed(() => auth.fbUser?.uid === job.value?.tradespersonId);
const isClient = computed(() => auth.fbUser?.uid === job.value?.clientId);

const canClientCancel = computed(
  () =>
    isClient.value &&
    job.value != null &&
    (CANCELLABLE_STATUSES as readonly string[]).includes(job.value.status),
);

const tradieDisplayName = computed(
  () => tradieInfo.value?.displayName?.trim() || "Your tradesperson",
);
const tradieAvatarInitial = computed(() =>
  (tradieDisplayName.value || "?").slice(0, 1).toUpperCase(),
);

// Mirrors the trust-badge expiry checks elsewhere — keeps badges honest
// even on a long-running job where the underlying coverage may lapse
// between booking and completion.
const now = Date.now();
const tradieInsuranceLive = computed(() => {
  if (!tradieInfo.value?.insuranceVerified) return false;
  const exp = tradieInfo.value.insuranceExpiresAt?.toDate?.().getTime();
  return exp == null || exp > now;
});
const tradieWsibLive = computed(() => {
  if (!tradieInfo.value?.wsibVerified) return false;
  const exp = tradieInfo.value.wsibExpiresAt?.toDate?.().getTime();
  return exp == null || exp > now;
});

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    // Auth-state race: when the user lands here via a direct URL (notification
    // click on cold cache, refresh, deep-link from email) the Firestore client
    // can fire the read before it has the auth token attached, so the rule
    // sees request.auth==null and denies. Wait for the store's auth init AND
    // refresh the ID token so Firestore picks up any role-claim updates
    // before reading. Both swallowed — getJob will throw on the actual
    // permission-denied path and we surface that.
    try {
      if (!auth.ready) await auth.init();
    } catch {
      /* auth init can reject if the startup user-doc read races; harmless
         here — keep going. */
    }
    if (auth.fbUser) {
      try {
        await auth.fbUser.getIdToken(true);
      } catch {
        /* token refresh failure isn't fatal */
      }
    }
    const id = route.params.id as string;
    job.value = await getJob(id);
    if (!job.value) return;
    // Parallel: intake schema + invoice lookup.
    const [remote, invoice] = await Promise.all([
      getIntakeSchema(job.value.trade),
      getInvoiceByJobId(id),
    ]);
    intakeFields.value = remote?.fields ?? SEED_INTAKE_SCHEMAS[job.value.trade] ?? [];
    invoiceId.value = invoice?.id ?? null;

    // Hydrate local form copies
    scheduledStart.value = job.value.scheduledStart?.toDate() ?? null;
    scheduledEnd.value = job.value.scheduledEnd?.toDate() ?? null;
    privateNotes.value = job.value.privateNotes ?? "";
    // Start the intake draft from whatever's already on the doc — empty {} on
    // marketplace-originated jobs, possibly populated if the client has been
    // editing in another tab.
    intakeDraft.value = { ...(job.value.intakeFormData ?? {}) };

    // Clients see a "Your tradesperson" panel — fetch the tradesperson doc
    // so we can render their photo + badges. Read can fail gracefully when
    // the tradie has gone invisible (suspended/de-listed): rules require
    // isVisible:true for non-owners. The panel falls back to a generic
    // "your tradesperson" display when tradieInfo stays null.
    if (isClient.value && job.value) {
      try {
        tradieInfo.value = await getTradesperson(job.value.tradespersonId);
      } catch {
        tradieInfo.value = null;
      }
    } else {
      tradieInfo.value = null;
    }
  } catch (e) {
    // Permission-denied or any other read failure: show the error empty
    // state instead of leaving the view stuck on "Loading…". Log the
    // current auth UID + the failure site so future regressions surface
    // immediately in the console instead of looking like a rules bug.
    console.warn(
      "[JobDetailView] read failed",
      { jobId: route.params.id, signedInAs: auth.fbUser?.uid ?? null },
      e,
    );
    loadError.value = humanizeError(e);
    job.value = null;
  } finally {
    loading.value = false;
  }
  // Fire-and-forget auto-log scan once the page has loaded. The server
  // enforces a 1-hour cooldown so this is cheap on repeat visits.
  void maybeAutoUpdateLog();
}

onMounted(load);

async function saveSchedule() {
  if (!job.value || !scheduledStart.value || !scheduledEnd.value) return;
  if (scheduledEnd.value <= scheduledStart.value) {
    toast.error("Pick an end time after the start.");
    return;
  }
  savingSchedule.value = true;
  try {
    const conflicts = await findCollisions(
      job.value.tradespersonId,
      scheduledStart.value,
      scheduledEnd.value,
      { excludeJobId: job.value.id },
    );
    if (conflicts.length > 0) {
      collisions.value = conflicts;
      showCollisionDialog.value = true;
      return;
    }
    await commitSchedule();
  } catch (e) {
    toast.error("Couldn't save schedule", humanizeError(e));
  } finally {
    savingSchedule.value = false;
  }
}

async function commitSchedule() {
  if (!job.value || !scheduledStart.value || !scheduledEnd.value) return;
  try {
    await scheduleJob(job.value.id, scheduledStart.value, scheduledEnd.value);
    showCollisionDialog.value = false;
    collisions.value = [];
    await load();
  } catch (e) {
    toast.error("Couldn't save schedule", humanizeError(e));
  }
}

async function setStatus(s: JobStatus) {
  if (!job.value) return;
  // Mirror Kanban guard: completing a job triggers an invoice draft.
  if (s === "complete" && !confirm("Mark this job complete? A draft invoice will be created.")) {
    return;
  }
  if (s === "cancelled" && !confirm("Cancel this job?")) return;
  try {
    await updateJobStatus(job.value.id, s);
    await load();
  } catch (e) {
    toast.error("Couldn't update status", humanizeError(e));
  }
}

async function saveNotes() {
  if (!job.value) return;
  try {
    await updatePrivateNotes(job.value.id, privateNotes.value);
    toast.success("Notes saved");
  } catch (e) {
    toast.error("Couldn't save notes", humanizeError(e));
  }
}

/** Manual "Update log" button: forces past the server-side cooldown. */
async function updateLogManually() {
  if (!job.value || updatingLog.value) return;
  updatingLog.value = true;
  try {
    const res = await updateJobLog(job.value.id, { force: true });
    if (res.appended) {
      // Reload the job so the notes textarea picks up the new entry.
      const fresh = await getJob(job.value.id);
      if (fresh) {
        job.value = fresh;
        privateNotes.value = fresh.privateNotes ?? "";
      }
      toast.success("Log updated", "Added a new entry from recent client activity.");
    } else {
      toast.info("Nothing new to log", "No action-relevant client messages since the last update.");
    }
  } catch (e) {
    toast.error("Couldn't update log", humanizeError(e));
  } finally {
    updatingLog.value = false;
  }
}

/**
 * Auto-trigger on first job-load. Server-side cooldown (1h) silently
 * short-circuits repeated page loads; on the rare run that actually
 * appends, we refresh the local notes copy. All other errors are swallowed
 * — auto-log failing shouldn't block the page.
 */
async function maybeAutoUpdateLog() {
  if (!job.value || !isTradie.value) return;
  try {
    const res = await updateJobLog(job.value.id);
    if (res.appended) {
      const fresh = await getJob(job.value.id);
      if (fresh) {
        job.value = fresh;
        privateNotes.value = fresh.privateNotes ?? "";
      }
    }
  } catch (e) {
    // Swallow — failed auto-log shouldn't pop a toast on every page load.
    console.warn("auto-log failed", e);
  }
}

async function submitBrief() {
  if (!job.value || savingIntake.value) return;
  // Soft check required intake fields client-side; server-side enforcement
  // would be a nice follow-up but isn't load-bearing here (client owns the
  // job and the doc rules already restrict who can update).
  for (const f of intakeFields.value) {
    if (f.required) {
      const v = intakeDraft.value[f.key];
      if (v === undefined || v === null || v === "") {
        toast.error("Missing required field", `Please fill: ${f.label}`);
        return;
      }
    }
  }
  savingIntake.value = true;
  try {
    await saveJobIntakeAndAdvance(job.value.id, intakeDraft.value);
    toast.success("Brief sent", "The tradesperson can now prepare a quote.");
    await load();
  } catch (e) {
    toast.error("Couldn't save brief", humanizeError(e));
  } finally {
    savingIntake.value = false;
  }
}

async function onMarkPaid() {
  if (!job.value || markingPaid.value) return;
  confirmDialog.require({
    message:
      "Confirm you've received payment for this job? This marks the invoice paid and closes out the job.",
    header: "Mark as paid?",
    icon: "pi pi-check-circle",
    acceptLabel: "Yes, mark paid",
    rejectLabel: "Not yet",
    accept: async () => {
      if (!job.value) return;
      markingPaid.value = true;
      try {
        await markJobPaid(job.value.id);
        toast.success("Marked paid", "Job complete. Leave the client a review when you can.");
        await load();
      } catch (e) {
        toast.error("Couldn't mark paid", humanizeError(e));
      } finally {
        markingPaid.value = false;
      }
    },
  });
}

function openCancelDialog() {
  cancelReason.value = "";
  showCancelDialog.value = true;
}

async function confirmCancel() {
  if (!job.value || cancelling.value) return;
  const reason = cancelReason.value.trim();
  if (!reason) {
    toast.error("Please add a reason so the tradesperson knows what happened.");
    return;
  }
  cancelling.value = true;
  try {
    await cancelJob(job.value.id, reason);
    toast.success("Job cancelled", "The tradesperson has been notified.");
    showCancelDialog.value = false;
    await load();
  } catch (e) {
    toast.error("Couldn't cancel", humanizeError(e));
  } finally {
    cancelling.value = false;
  }
}

function onReturnToApplicants() {
  if (!job.value?.sourcePostId) return;
  const postId = job.value.sourcePostId;
  confirmDialog.require({
    message:
      "Return to your applicants? This cancels the current job and reopens your post so you can pick again. " +
      "Rejected applicants will stay rejected.",
    header: "Return to applicants?",
    icon: "pi pi-undo",
    acceptLabel: "Yes, return",
    rejectLabel: "Cancel",
    accept: async () => {
      returningToApplicants.value = true;
      try {
        await returnToApplicants(postId);
        toast.success("Returned to applicants");
        router.push({ name: "JobPostDetail", params: { postId } });
      } catch (e) {
        toast.error("Couldn't return", humanizeError(e));
      } finally {
        returningToApplicants.value = false;
      }
    },
  });
}

const statusColor: Record<JobStatus, "info" | "warn" | "success" | "danger" | "secondary"> = {
  accepted: "info",
  requested: "info",
  quoted: "warn",
  quote_accepted: "success",
  scheduled: "success",
  in_progress: "success",
  awaiting_client_approval: "warn",
  awaiting_payment: "warn",
  complete: "success",
  reviewed: "secondary",
  cancelled: "danger",
};
</script>

<template>
  <section
    class="bs-container py-6"
    :class="{ 'pb-28': showStickyCTA }"
  >
    <RouterLink to="/dashboard" class="text-xs text-[color:var(--bs-muted)]">← Dashboard</RouterLink>

    <div v-if="loading" class="bs-empty mt-4">Loading…</div>
    <div v-else-if="loadError" class="bs-empty mt-4">
      <i class="pi pi-exclamation-circle text-3xl mb-2 block text-amber-600"></i>
      <p class="font-medium">We couldn't open this job.</p>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        The link may be stale, or this job belongs to a different account.
      </p>
      <RouterLink to="/dashboard" class="inline-block mt-3">
        <Button label="Back to dashboard" icon="pi pi-arrow-left" outlined />
      </RouterLink>
    </div>
    <div v-else-if="!job" class="bs-empty mt-4">
      <i class="pi pi-question-circle text-3xl mb-2 block text-[color:var(--bs-muted)]"></i>
      <p class="font-medium">Job not found.</p>
      <RouterLink to="/dashboard" class="inline-block mt-3">
        <Button label="Back to dashboard" icon="pi pi-arrow-left" outlined />
      </RouterLink>
    </div>
    <template v-else-if="job">
      <header class="flex items-start justify-between gap-3 mt-2 mb-4">
        <div class="min-w-0 flex-1">
          <h1 class="text-xl font-bold break-words">{{ job.title }}</h1>
          <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
            {{ tradeLabel(job.trade) }} • Created {{ date(job.createdAt) }}
          </div>
          <div class="text-xs text-[color:var(--bs-muted)]">
            {{ job.address.line1 }}, {{ job.address.city }}
          </div>
        </div>
        <Tag :value="job.status" :severity="statusColor[job.status]" class="shrink-0" />
      </header>

      <!-- ACCEPTED-STATUS BANNERS -->
      <div
        v-if="job.status === 'accepted' && isClient"
        class="bs-card p-4 mb-4 border-l-4 border-l-[color:var(--bs-blue)]"
      >
        <div class="flex items-start gap-3">
          <i class="pi pi-info-circle text-[color:var(--bs-blue)] text-lg mt-0.5"></i>
          <div class="flex-1">
            <div class="font-semibold">Complete the brief so they can quote</div>
            <p class="text-sm text-[color:var(--bs-muted)] mt-1">
              Fill in the trade-specific details below and submit. The tradesperson can already see your original post and chat with you.
            </p>
            <div v-if="job.sourcePostId" class="mt-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <Button
                label="Return to applicants"
                icon="pi pi-undo"
                text
                size="small"
                :loading="returningToApplicants"
                class="self-start -ml-2"
                @click="onReturnToApplicants"
              />
              <span class="text-xs text-[color:var(--bs-muted)]">
                You can still switch until you submit the brief.
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        v-else-if="job.status === 'accepted' && isTradie"
        class="bs-card p-4 mb-4 border-l-4 border-l-[color:var(--bs-blue-light)]"
      >
        <div class="flex items-start gap-3">
          <i class="pi pi-clock text-[color:var(--bs-blue)] text-lg mt-0.5"></i>
          <div>
            <div class="font-semibold">Awaiting client details</div>
            <p class="text-sm text-[color:var(--bs-muted)] mt-1">
              The client is filling in the trade-specific brief. You can introduce yourself in chat in the meantime — they'll see your message.
            </p>
          </div>
        </div>
      </div>

      <!-- Client quote-approval banner — tradesperson sent a quote and is
           waiting on the client to accept or discuss. -->
      <ClientQuoteApprovalBanner
        v-if="isClient && job.status === 'quoted'"
        :job-id="job.id"
        class="mb-4"
        @decided="load"
      />

      <!-- Client approval banner — tradesperson handed the job over for
           sign-off. Renders above everything else so the client sees the
           call-to-action before the chat / invoice. -->
      <ClientApprovalBanner
        v-if="isClient && job.status === 'awaiting_client_approval'"
        :job-id="job.id"
        class="mb-4"
        @decided="load"
      />

      <div class="grid lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 space-y-4">
          <ChatThread
            :chat-id="job.chatId"
            :job-id="job.id"
            :enable-ai-replies="isTradie"
          />

          <div class="bs-card p-4">
            <h3 class="font-semibold text-sm mb-2">Original request</h3>
            <p class="text-sm whitespace-pre-wrap">{{ job.description }}</p>
            <div v-if="job.intakePhotos.length" class="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
              <a v-for="p in job.intakePhotos" :key="p" :href="p" target="_blank" rel="noopener">
                <img :src="p" class="aspect-square object-cover rounded" alt="" />
              </a>
            </div>
            <div v-if="intakeFields.length" class="mt-4">
              <h4 class="font-medium text-sm mb-2">Trade-specific details</h4>
              <!-- Editable for the client when job is in 'accepted' status
                   (the marketplace flow's intake step); read-only otherwise. -->
              <IntakeFormRenderer
                v-if="isClient && job.status === 'accepted'"
                v-model="intakeDraft"
                :fields="intakeFields"
              />
              <IntakeFormRenderer
                v-else
                :model-value="job.intakeFormData"
                :fields="intakeFields"
                readonly
                @update:model-value="() => {}"
              />
              <div v-if="isClient && job.status === 'accepted'" class="mt-3">
                <Button
                  label="Submit brief"
                  icon="pi pi-send"
                  :loading="savingIntake"
                  @click="submitBrief"
                />
              </div>
            </div>
          </div>

          <!-- Quote (if one's been drafted/sent). Shown to both parties;
               tradesperson can "Revise & re-send" via the QuoteSheet. The
               read-receipt stamp only fires for the client viewer. -->
          <QuoteCard
            :job-id="job.id"
            :can-edit="isTradie"
            :stamp-viewed-on-load="isClient"
            @revise="showQuoteSheet = true"
          />

          <InvoiceEditor v-if="invoiceId" :invoice-id="invoiceId" :can-edit="isTradie" />
        </div>

        <aside class="space-y-4">
          <!-- Client-only: who's coming. Uber-style trust signal — the
               client sees a face + verified badges before the tradesperson
               shows up at their door. -->
          <div v-if="isClient" class="bs-card p-3">
            <h3 class="font-semibold text-sm mb-2">Your tradesperson</h3>
            <div class="flex items-start gap-3">
              <Avatar
                v-if="tradieInfo?.photoURL"
                :image="tradieInfo.photoURL"
                size="large"
                shape="circle"
              />
              <Avatar
                v-else
                :label="tradieAvatarInitial"
                size="large"
                shape="circle"
                style="background-color: var(--bs-blue); color: white; font-weight: 600;"
              />
              <div class="min-w-0 flex-1">
                <div class="font-semibold text-sm truncate">{{ tradieDisplayName }}</div>
                <div
                  v-if="tradieInfo?.ratingCount"
                  class="text-xs text-[color:var(--bs-muted)] mt-0.5"
                >
                  {{ tradieInfo.ratingAvg.toFixed(1) }} ★ ({{ tradieInfo.ratingCount }})
                </div>
                <div class="flex flex-wrap items-center gap-1 mt-2">
                  <Tag
                    v-if="tradieInfo?.idVerified"
                    value="ID verified"
                    severity="success"
                  />
                  <Tag v-if="tradieInsuranceLive" value="Insured" severity="info" />
                  <Tag v-if="tradieWsibLive" value="WSIB" severity="info" />
                </div>
              </div>
            </div>
            <RouterLink
              v-if="tradieInfo"
              :to="{ name: 'TradieProfile', params: { uid: tradieInfo.id } }"
              class="mt-3 text-xs text-[color:var(--bs-blue)] inline-block"
            >View full profile →</RouterLink>
          </div>

          <!-- Quote-accepted prompt — client said yes, tradie now needs
               to pick a date. The Schedule card below does the actual
               picking; this just elevates the next action so it's not
               buried below the chat. -->
          <div
            v-if="isTradie && job.status === 'quote_accepted'"
            class="bs-card p-3 border-l-4 border-l-emerald-500"
          >
            <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
              <i class="pi pi-calendar-plus text-emerald-600"></i>
              Client accepted — pick a date
            </h3>
            <p class="text-xs text-[color:var(--bs-muted)]">
              Use the Schedule section below to set start + end. Saving the
              schedule moves the job to Scheduled and the client gets notified.
            </p>
          </div>

          <!-- Mirror banner for the client side so they're not left guessing
               after they accept. -->
          <div
            v-if="isClient && job.status === 'quote_accepted'"
            class="bs-card p-3 border-l-4 border-l-emerald-500"
          >
            <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
              <i class="pi pi-check text-emerald-600"></i>
              Quote accepted
            </h3>
            <p class="text-xs text-[color:var(--bs-muted)]">
              The tradesperson is picking a date — you'll get a notification when
              it's scheduled.
            </p>
          </div>

          <!-- Awaiting-payment CTA — promoted to top of sidebar so the
               tradie can settle up in one tap once the client has paid. -->
          <div
            v-if="isTradie && job.status === 'awaiting_payment'"
            class="bs-card p-3 border-l-4 border-l-emerald-500"
          >
            <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
              <i class="pi pi-wallet text-emerald-600"></i>
              Payment received?
            </h3>
            <p class="text-xs text-[color:var(--bs-muted)] mb-3">
              Mark the invoice paid to close out the job. The client gets a receipt and the
              review prompt appears.
            </p>
            <Button
              label="Mark as paid"
              icon="pi pi-check"
              severity="success"
              class="w-full"
              :loading="markingPaid"
              @click="onMarkPaid"
            />
          </div>

          <!-- Awaiting-client-approval status banner — read-only for the
               tradie; they've already done the wrap-up and the client now
               owns the next move. -->
          <div
            v-if="isTradie && job.status === 'awaiting_client_approval'"
            class="bs-card p-3 border-l-4 border-l-amber-500"
          >
            <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
              <i class="pi pi-hourglass text-amber-600"></i>
              Awaiting client approval
            </h3>
            <p class="text-xs text-[color:var(--bs-muted)]">
              The client has the wrap-up. They'll approve the work or request changes —
              you'll get a notification either way.
            </p>
          </div>

          <div v-if="isTradie" class="bs-card p-3">
            <label for="job-status-select" class="block font-semibold text-sm mb-2">Status</label>
            <Select
              input-id="job-status-select"
              :model-value="job.status"
              :options="statusOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              @update:model-value="(v) => setStatus(v as JobStatus)"
            />
            <p class="text-[11px] text-[color:var(--bs-muted)] mt-2 leading-snug">
              Use this for one-off corrections only. The normal flow is the
              "Finish job" button below and the client's approve/pay actions.
            </p>
          </div>

          <div class="bs-card p-3">
            <h3 class="font-semibold text-sm mb-2">Schedule</h3>
            <div v-if="job.scheduledStart" class="text-sm leading-snug">
              <div>{{ dateTime(job.scheduledStart) }}</div>
              <div class="text-[color:var(--bs-muted)]">to {{ dateTime(job.scheduledEnd) }}</div>
            </div>
            <p
              v-else-if="!isTradie"
              class="text-xs text-[color:var(--bs-muted)]"
            >Not scheduled yet.</p>
            <template v-if="isTradie">
              <div class="mt-3 space-y-2">
                <div>
                  <label for="job-schedule-start" class="block text-[11px] text-[color:var(--bs-muted)] mb-1">Start</label>
                  <DatePicker
                    v-model="scheduledStart"
                    input-id="job-schedule-start"
                    show-time
                    hour-format="24"
                    class="w-full"
                    placeholder="Start"
                  />
                </div>
                <div>
                  <label for="job-schedule-end" class="block text-[11px] text-[color:var(--bs-muted)] mb-1">End</label>
                  <DatePicker
                    v-model="scheduledEnd"
                    input-id="job-schedule-end"
                    show-time
                    hour-format="24"
                    class="w-full"
                    placeholder="End"
                  />
                </div>
              </div>
              <Button
                label="Save schedule"
                icon="pi pi-calendar"
                class="mt-3 w-full"
                outlined
                :loading="savingSchedule"
                @click="saveSchedule"
              />
            </template>
          </div>

          <TimeTrackerCard
            v-if="isTradie || isClient"
            :job-id="job.id"
            :tradesperson-id="job.tradespersonId"
            :is-tradie="isTradie"
          />

          <ExpensesCard
            v-if="isTradie"
            :job-id="job.id"
            :client-id="job.clientId"
            :tradesperson-id="job.tradespersonId"
          />

          <div v-if="isTradie" class="bs-card p-3">
            <label for="job-private-notes" class="block font-semibold text-sm mb-2">
              Private notes
              <span class="font-normal text-[color:var(--bs-muted)]">(tradesperson only)</span>
            </label>
            <Textarea id="job-private-notes" v-model="privateNotes" rows="6" class="w-full" />
            <Button label="Save notes" icon="pi pi-save" outlined size="small" class="mt-2" @click="saveNotes" />
            <p class="text-[11px] text-[color:var(--bs-muted)] mt-2">
              Use the AI button at the bottom-right to summarise recent client
              messages into a new log entry.
            </p>
          </div>

          <div v-if="canClientCancel" class="bs-card p-3">
            <h3 class="font-semibold text-sm mb-2">Change of plans?</h3>
            <p class="text-xs text-[color:var(--bs-muted)] mb-2">
              You can cancel until work starts. The tradesperson will be notified.
            </p>
            <Button
              label="Cancel this job"
              icon="pi pi-ban"
              severity="danger"
              outlined
              size="small"
              class="w-full"
              @click="openCancelDialog"
            />
          </div>

          <div v-if="job.status === 'complete' || job.status === 'reviewed'" class="bs-card p-3">
            <h3 class="font-semibold text-sm mb-2">Reviews</h3>
            <ReviewPrompt
              :job="job"
              :as-role="isClient ? 'client' : 'tradesperson'"
              @reviewed="load"
            />
          </div>
        </aside>
      </div>
    </template>

    <!-- Sticky bottom CTA: the tradie's primary action for this status.
         One slot, status-driven label so the page never offers more than
         one "next step" at a time. -->
    <div
      v-if="showStickyCTA && job"
      class="fixed inset-x-0 bottom-0 z-30 border-t border-[color:var(--bs-border)] bg-white/95 backdrop-blur p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-2px_8px_rgba(0,0,0,0.04)]"
    >
      <div class="bs-container">
        <Button
          v-if="job.status === 'requested'"
          label="Prepare quote"
          icon="pi pi-file"
          class="w-full"
          size="large"
          @click="showQuoteSheet = true"
        />
        <Button
          v-else-if="job.status === 'quoted'"
          label="Edit & re-send quote"
          icon="pi pi-pencil"
          class="w-full"
          size="large"
          outlined
          @click="showQuoteSheet = true"
        />
        <Button
          v-else-if="job.status === 'in_progress'"
          label="Finish job & prepare invoice"
          icon="pi pi-check-circle"
          class="w-full"
          size="large"
          @click="showFinishSheet = true"
        />
      </div>
    </div>

    <!-- AI log update FAB — floats over the page so the tradesperson can
         pull a chat summary into Private notes from anywhere on the job.
         Sits above the sticky CTA when one's showing, otherwise pins to
         the bottom-right of the viewport. Violet AI gradient so it reads
         as a distinct (secondary) capability vs. the primary status CTAs. -->
    <button
      v-if="showAiFab"
      type="button"
      class="ai-log-fab"
      :class="{ 'ai-log-fab--above-cta': showStickyCTA }"
      :disabled="updatingLog"
      :title="updatingLog ? 'Summarising recent chat…' : 'Summarise recent client chat into your notes'"
      @click="updateLogManually"
    >
      <i
        :class="updatingLog ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'"
        class="ai-log-fab__icon"
      ></i>
      <span class="ai-log-fab__label">
        {{ updatingLog ? "Summarising…" : "AI log update" }}
      </span>
    </button>

    <FinishJobSheet
      v-if="job && isTradie"
      v-model:visible="showFinishSheet"
      :job-id="job.id"
      :tradesperson-id="job.tradespersonId"
      :client-id="job.clientId"
      @submitted="load"
    />

    <QuoteSheet
      v-if="job && isTradie"
      v-model:visible="showQuoteSheet"
      :job-id="job.id"
      @submitted="load"
    />

    <Dialog
      v-model:visible="showCollisionDialog"
      modal
      header="Schedule conflict"
      :style="{ width: '32rem', maxWidth: '92vw' }"
    >
      <p class="text-sm text-[color:var(--bs-text)] mb-3">
        The time you picked overlaps with
        {{ collisions.length }} existing
        {{ collisions.length === 1 ? "booking" : "bookings" }}:
      </p>
      <ul class="space-y-2">
        <li
          v-for="c in collisions"
          :key="c.id"
          class="rounded-lg border border-[color:var(--bs-border)] p-3"
        >
          <div class="flex items-start gap-2">
            <i
              :class="
                c.type === 'job'
                  ? 'pi pi-briefcase text-[color:var(--bs-blue)] mt-0.5'
                  : 'pi pi-ban text-amber-600 mt-0.5'
              "
            ></i>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm">{{ c.label }}</div>
              <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
                {{ dateTime(c.start) }} → {{ dateTime(c.end) }}
              </div>
            </div>
          </div>
        </li>
      </ul>
      <p class="mt-4 text-xs text-[color:var(--bs-muted)]">
        You can still schedule on top — useful when a block-off was a soft hold
        you're happy to override. It also lets you double-book if that's actually
        what you mean.
      </p>
      <template #footer>
        <Button label="Pick a different time" text @click="showCollisionDialog = false" />
        <Button
          label="Schedule anyway"
          icon="pi pi-calendar-plus"
          severity="warn"
          @click="commitSchedule"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="showCancelDialog"
      modal
      header="Cancel this job?"
      :style="{ width: '28rem', maxWidth: '92vw' }"
    >
      <p class="text-sm text-[color:var(--bs-text)] mb-3">
        Tell the tradesperson what changed. They'll see this in their inbox.
      </p>
      <Textarea
        v-model="cancelReason"
        rows="4"
        class="w-full"
        placeholder="e.g. I fixed it myself, scope changed, picking a different timeline…"
        :maxlength="1000"
        autofocus
      />
      <template #footer>
        <Button label="Keep job" text @click="showCancelDialog = false" />
        <Button
          label="Cancel job"
          icon="pi pi-ban"
          severity="danger"
          :loading="cancelling"
          @click="confirmCancel"
        />
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
/* Floating AI log button. Larger and bolder than a typical FAB because
   it carries a label — but kept a tier below the primary status CTAs
   (lower shadow weight, secondary-violet rather than primary-blue) so
   the eye still goes to the sticky bottom bar first. */
.ai-log-fab {
  position: fixed;
  right: max(1rem, env(safe-area-inset-right));
  bottom: max(1rem, env(safe-area-inset-bottom));
  z-index: 35; /* above the sticky CTA (z-30) so it floats over */
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.85rem 1.25rem;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  color: white;
  font-weight: 600;
  font-size: 0.95rem;
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow:
    0 10px 24px -8px rgba(99, 102, 241, 0.55),
    0 4px 10px -2px rgba(0, 0, 0, 0.15);
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    background 0.15s ease,
    bottom 0.2s ease;
}
.ai-log-fab:hover:not(:disabled) {
  transform: translateY(-1px);
  background: linear-gradient(135deg, #7c3aed, #4f46e5);
  box-shadow:
    0 14px 28px -8px rgba(99, 102, 241, 0.65),
    0 6px 12px -2px rgba(0, 0, 0, 0.18);
}
.ai-log-fab:active:not(:disabled) {
  transform: translateY(0);
}
.ai-log-fab:disabled {
  cursor: default;
  opacity: 0.7;
  transform: none;
}
.ai-log-fab__icon {
  font-size: 1.15rem;
  line-height: 1;
}
.ai-log-fab__label {
  white-space: nowrap;
}

/* When the page is showing the sticky CTA bar, lift the FAB above it so
   neither covers the other. ~4.75rem clears the CTA bar (~3.5rem of
   button + padding + border) without touching the safe-area accommodations
   that the sticky bar already applies. */
.ai-log-fab--above-cta {
  bottom: calc(max(1rem, env(safe-area-inset-bottom)) + 4.75rem);
}

/* On narrow phones drop the label to an icon-only FAB so it doesn't
   crowd the screen edge or overlap the sticky CTA's full-width button. */
@media (max-width: 420px) {
  .ai-log-fab {
    padding: 0.95rem;
    border-radius: 50%;
  }
  .ai-log-fab__label {
    /* Visually hidden but still announced by screen readers. */
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
  .ai-log-fab__icon {
    font-size: 1.35rem;
  }
}
</style>
