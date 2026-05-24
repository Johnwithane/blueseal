<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
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
import FinishJobSheet from "@/components/FinishJobSheet.vue";
import ClientApprovalBanner from "@/components/ClientApprovalBanner.vue";
import QuoteSheet from "@/components/QuoteSheet.vue";
import ClientQuoteApprovalBanner from "@/components/ClientQuoteApprovalBanner.vue";
import { SEED_INTAKE_SCHEMAS } from "@/data/intakeSchemas";
import { getIntakeSchema } from "@/firebase/services/intakeFormSchemas";
import type { IntakeField } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { STATUS_LABEL, STATUS_SEVERITY } from "@/utils/jobStatus";
import JobTabBar, { type JobTab } from "@/features/jobDetail/JobTabBar.vue";
import BriefTab from "@/features/jobDetail/BriefTab.vue";
import ScheduleTab from "@/features/jobDetail/ScheduleTab.vue";
import InvoiceTab from "@/features/jobDetail/InvoiceTab.vue";
import JobChatButton from "@/features/jobDetail/JobChatButton.vue";
import JobChatOverlay from "@/features/jobDetail/JobChatOverlay.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const confirmDialog = useConfirm();
const { dateTime } = useFormatters();

function formatScheduled(
  start: { toDate(): Date } | null | undefined,
  end: { toDate(): Date } | null | undefined,
): string {
  if (!start) return "";
  const s = start.toDate();
  const e = end?.toDate();
  // Same-day bookings: show "Mon Apr 15, 9:00 AM – 11:30 AM" so the
  // end-time isn't crowded with a redundant date. Cross-day (rare
  // but possible for multi-visit jobs scheduled in one block) shows
  // both ends in full.
  if (!e) return dateTime(s);
  const sameDay = s.toDateString() === e.toDateString();
  if (sameDay) {
    const endTime = new Intl.DateTimeFormat("en-CA", {
      hour: "numeric",
      minute: "2-digit",
    }).format(e);
    return `${dateTime(s)} – ${endTime}`;
  }
  return `${dateTime(s)} → ${dateTime(e)}`;
}

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

const updatingLog = ref(false);

const intakeDraft = ref<Record<string, unknown>>({});
const savingIntake = ref(false);
const returningToApplicants = ref(false);

const showCancelDialog = ref(false);
const cancelReason = ref("");
const cancelling = ref(false);

const collisions = ref<Collision[]>([]);
const showCollisionDialog = ref(false);
const savingSchedule = ref(false);

const showFinishSheet = ref(false);
const markingPaid = ref(false);
const showQuoteSheet = ref(false);

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

// Tab list. Role-aware: Notes is tradie-only. Badges flag a tab where the
// signed-in user has work to do — the sticky CTA and top banners already
// surface the primary action, so badges are a quieter "tap here, there's
// something to settle" hint.
// Tab list. Chat is NOT a tab — it lives in a bottom-anchored overlay
// (JobChatButton + JobChatOverlay) so the chat composer never fights the
// sticky CTA, and the AI assistant shares that surface as a sub-tab.
const tabs = computed<JobTab[]>(() => {
  if (!job.value) return [];
  const s = job.value.status;
  return [
    {
      key: "brief",
      label: "Brief",
      icon: "pi-info-circle",
      badge: isClient.value && s === "accepted" ? "dot" : undefined,
    },
    {
      key: "schedule",
      label: "Schedule",
      icon: "pi-calendar",
      badge: isTradie.value && s === "quote_accepted" ? "dot" : undefined,
    },
    {
      key: "invoice",
      label: "Invoice",
      icon: "pi-receipt",
      badge:
        s === "awaiting_client_approval" || s === "awaiting_payment" ? "dot" : undefined,
    },
  ];
});

const validTabKeys = computed(() => new Set(tabs.value.map((t) => t.key)));

const activeTab = computed<string>(() => {
  const q = route.query.tab;
  const key = typeof q === "string" ? q : "";
  return validTabKeys.value.has(key) ? key : "brief";
});

// Chat overlay open state. Driven by the floating JobChatButton; the
// overlay also handles its own close (backdrop tap / X button).
const chatOverlayOpen = ref(false);

// Sticky bottom CTA: tradie's primary action for the current status. Drives
// the bottom padding on the section (so content isn't hidden behind the
// fixed bar) and the bar's visibility. Stays visible across every tab —
// the bar gets thinner on mobile so the chat composer can sit comfortably
// above it.
const stickyCTAStatuses: ReadonlySet<JobStatus> = new Set([
  "requested",
  "quoted",
  "in_progress",
]);
const showStickyCTA = computed(
  () => job.value != null && isTradie.value && stickyCTAStatuses.has(job.value.status),
);

function onTabChange(key: string) {
  // Use replace, not push — back button shouldn't have to walk through every
  // tab tap to leave the page.
  router.replace({ query: { ...route.query, tab: key } });
}

// If the active tab disappears (e.g. role changes), bounce to Brief so the
// URL stops pointing at nothing.
watch(validTabKeys, (keys) => {
  const q = route.query.tab;
  if (typeof q === "string" && q && !keys.has(q)) {
    router.replace({ query: { ...route.query, tab: "brief" } });
  }
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
    // before reading.
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
    const [remote, invoice] = await Promise.all([
      getIntakeSchema(job.value.trade),
      getInvoiceByJobId(id),
    ]);
    intakeFields.value = remote?.fields ?? SEED_INTAKE_SCHEMAS[job.value.trade] ?? [];
    invoiceId.value = invoice?.id ?? null;

    scheduledStart.value = job.value.scheduledStart?.toDate() ?? null;
    scheduledEnd.value = job.value.scheduledEnd?.toDate() ?? null;
    privateNotes.value = job.value.privateNotes ?? "";
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

async function updateLogManually() {
  if (!job.value || updatingLog.value) return;
  updatingLog.value = true;
  try {
    const res = await updateJobLog(job.value.id, { force: true });
    if (res.appended) {
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
    console.warn("auto-log failed", e);
  }
}

async function submitBrief() {
  if (!job.value || savingIntake.value) return;
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
</script>

<template>
  <section
    class="bs-container py-3 sm:py-6"
    :class="{ 'job-detail--cta-on': showStickyCTA }"
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
      <header class="flex items-start justify-between gap-2 mt-1 mb-3">
        <div class="min-w-0 flex-1">
          <h1 class="text-lg font-bold break-words leading-tight">{{ job.title }}</h1>
          <div class="text-[11px] text-[color:var(--bs-muted)] mt-0.5 truncate">
            {{ tradeLabel(job.trade) }} · {{ job.address.line1 }}, {{ job.address.city }}
          </div>
        </div>
        <Tag
          :value="STATUS_LABEL[job.status]"
          :severity="STATUS_SEVERITY[job.status]"
          class="shrink-0"
        />
      </header>

      <!-- Global banners — always above the tabs so the user can't miss them
           while browsing tab content. -->
      <div
        v-if="job.status === 'accepted' && isClient"
        class="bs-card p-4 mb-4 border-l-4 border-l-[color:var(--bs-blue)]"
      >
        <div class="flex items-start gap-3">
          <i class="pi pi-info-circle text-[color:var(--bs-blue)] text-lg mt-0.5"></i>
          <div class="flex-1">
            <div class="font-semibold">Complete the brief so they can quote</div>
            <p class="text-sm text-[color:var(--bs-muted)] mt-1">
              Open the <span class="font-medium">Brief</span> tab and fill in the trade-specific
              details. The tradesperson can already see your original post and chat with you.
            </p>
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
              The client is filling in the trade-specific brief. You can introduce
              yourself in chat in the meantime — they'll see your message.
            </p>
          </div>
        </div>
      </div>

      <ClientQuoteApprovalBanner
        v-if="isClient && job.status === 'quoted'"
        :job-id="job.id"
        class="mb-4"
        @decided="load"
      />

      <ClientApprovalBanner
        v-if="isClient && job.status === 'awaiting_client_approval'"
        :job-id="job.id"
        class="mb-4"
        @decided="load"
      />

      <!-- Scheduled-state confirmation. Once both parties have agreed
           a quote and the tradesperson has picked a slot, the booking
           is the most important piece of info on the page — surface it
           in the banners rail rather than burying it inside the
           Schedule tab. Same banner copy for both roles since it's a
           shared agreement. -->
      <div
        v-if="job.status === 'scheduled' && job.scheduledStart"
        class="bs-card p-4 mb-4 border-l-4 border-l-blue-500"
      >
        <div class="flex items-start gap-3">
          <i class="pi pi-calendar text-blue-600 text-xl mt-0.5"></i>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-base">
              {{ isClient ? "You're booked in" : "Booked with the client" }}
            </div>
            <p class="text-sm mt-1">
              {{ formatScheduled(job.scheduledStart, job.scheduledEnd) }}
            </p>
            <p class="text-xs text-[color:var(--bs-muted)] mt-1">
              {{ isClient
                ? "The tradesperson will arrive at the agreed time. Use the chat below for any last-minute updates."
                : "Reminder will fire 24 h ahead. Use the chat for any last-minute coordination." }}
            </p>
          </div>
        </div>
      </div>

      <JobTabBar
        :tabs="tabs"
        :model-value="activeTab"
        @update:model-value="onTabChange"
      />

      <div>
        <BriefTab
          v-if="activeTab === 'brief'"
          v-model:intake-draft="intakeDraft"
          v-model:private-notes="privateNotes"
          :job="job"
          :is-client="isClient"
          :is-tradie="isTradie"
          :intake-fields="intakeFields"
          :tradie-info="tradieInfo"
          :tradie-insurance-live="tradieInsuranceLive"
          :tradie-wsib-live="tradieWsibLive"
          :saving-intake="savingIntake"
          :returning-to-applicants="returningToApplicants"
          :status-options="statusOptions"
          :updating-log="updatingLog"
          @submit-brief="submitBrief"
          @status-change="setStatus"
          @return-to-applicants="onReturnToApplicants"
          @save-notes="saveNotes"
          @update-log="updateLogManually"
        />
        <ScheduleTab
          v-else-if="activeTab === 'schedule'"
          v-model:scheduled-start="scheduledStart"
          v-model:scheduled-end="scheduledEnd"
          :job="job"
          :is-client="isClient"
          :is-tradie="isTradie"
          :saving-schedule="savingSchedule"
          :can-client-cancel="canClientCancel"
          @save-schedule="saveSchedule"
          @open-cancel-dialog="openCancelDialog"
        />
        <InvoiceTab
          v-else-if="activeTab === 'invoice'"
          :job="job"
          :is-client="isClient"
          :is-tradie="isTradie"
          :invoice-id="invoiceId"
          :marking-paid="markingPaid"
          @mark-paid="onMarkPaid"
          @revise-quote="showQuoteSheet = true"
          @reviewed="load"
        />
      </div>

      <!-- Chat + AI lives in a bottom-anchored overlay rather than as a
           tab. The composer never has to share the bottom edge with the
           sticky CTA, and the AI assistant rides along as a sub-tab. -->
      <JobChatButton
        :chat-id="job.chatId"
        :lift-for-cta="showStickyCTA"
        @click="chatOverlayOpen = true"
      />
      <JobChatOverlay
        v-model:visible="chatOverlayOpen"
        :job="job"
        :is-tradie="isTradie"
      />
    </template>

    <!-- Sticky bottom CTA: the tradie's primary action for this status.
         One slot, status-driven label so the page never offers more than
         one "next step" at a time. Lives outside the tabs so it persists
         while the user browses other surfaces. -->
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
