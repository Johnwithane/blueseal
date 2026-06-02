<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
import Dialog from "primevue/dialog";
import Avatar from "primevue/avatar";
import {
  CANCELLABLE_STATUSES,
  cancelJob,
  subscribeJob,
  getJobPrivateNotes,
  markJobPaid,
  markUpfrontFeePaid,
  scheduleJob,
  updatePrivateNotes,
  saveJobIntakeAndAdvance,
} from "@/firebase/services/jobs";
import { returnToApplicants } from "@/firebase/services/jobPosts";
import { updateJobLog } from "@/firebase/services/assistant";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { findCollisions, type Collision } from "@/firebase/services/bookings";
import { useConfirm } from "primevue/useconfirm";
import { getInvoiceByJobId } from "@/firebase/services/invoices";
import { subscribeReviewPair } from "@/firebase/services/reviews";
import { useAuthStore } from "@/stores/auth";
import type {
  JobDoc,
  JobStatus,
  ReviewPairDoc,
  TradespersonDoc,
  WithId,
} from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import FinishJobSheet from "@/components/FinishJobSheet.vue";
import ClientApprovalBanner from "@/components/ClientApprovalBanner.vue";
import QuoteSheet from "@/components/QuoteSheet.vue";
import ClientQuoteApprovalBanner from "@/components/ClientQuoteApprovalBanner.vue";
import UpfrontFeePaymentBanner from "@/components/UpfrontFeePaymentBanner.vue";
import TradieChangesRequestedBanner from "@/components/TradieChangesRequestedBanner.vue";
import MutualReviewCard from "@/components/MutualReviewCard.vue";
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
import LoadingState from "@/components/LoadingState.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const confirmDialog = useConfirm();
const { dateTime, money } = useFormatters();

// Back affordance — the bottom nav is hidden on the job page (mobileCompact),
// so this is the primary way out. Prefer real history; fall back to the
// dashboard for deep-links / fresh loads where there's nothing to go back to.
function goBack() {
  if (window.history.state?.back) router.back();
  else router.push({ name: "Dashboard" });
}

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
const reviewPair = ref<WithId<ReviewPairDoc> | null>(null);
// Live subscription handle for the mutual-review pair. Owned at the
// JobDetailView level (not inside InvoiceTab) so the top-of-page banner
// can render the right CTA even when the Brief or Schedule tab is
// active — without that, the user has to hunt through tabs to find
// the review prompt after a job is paid.
let unsubscribeReviewPair: (() => void) | null = null;
// Live subscription to the job doc itself. Owned here so status changes from
// the counterparty propagate to the banners + sticky CTA without a refresh.
let unsubscribeJob: (() => void) | null = null;
const intakeFields = ref<IntakeField[]>([]);
const invoiceId = ref<string | null>(null);
// True only for invoices sent through the Stripe Connect pipeline (i.e.
// `payment.clientSecret` is set). Legacy "mark paid" / manual-flow
// invoices have no client-side pay path, so the InvoiceTab's pay /
// receipt CTAs must not link to /invoices/:id/pay — those would just
// surface a "re-send it from their dashboard" error. Pre-launch the
// difference is moot (no legacy invoices in prod), but during the
// rollout window stale jobs may exist and shouldn't break.
const invoicePayable = ref(false);
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
const markingUpfront = ref(false);
const showQuoteSheet = ref(false);

const isTradie = computed(() => auth.fbUser?.uid === job.value?.tradespersonId);
const isClient = computed(() => auth.fbUser?.uid === job.value?.clientId);

// Best-effort name resolution for PDFs + downstream UI. Falls back through
// the data we have available locally so the PDF "From" / "To" header
// never reads "Tradesperson" / "Client" when a real name exists somewhere:
// 1. The denormalized field on the job (set at create time, blank on old
//    test jobs).
// 2. The auth store's display name for the current user's own side.
// 3. The tradesperson public doc (loaded for client viewers).
// 4. A generic placeholder so something always renders.
const resolvedTradespersonName = computed(() => {
  const denorm = job.value?.tradespersonName?.trim();
  if (denorm) return denorm;
  if (isTradie.value && auth.fbUser?.displayName?.trim()) {
    return auth.fbUser.displayName.trim();
  }
  const fromTradieDoc = tradieInfo.value?.displayName?.trim();
  if (fromTradieDoc) return fromTradieDoc;
  return "Tradesperson";
});

const resolvedClientName = computed(() => {
  const denorm = job.value?.clientName?.trim();
  if (denorm) return denorm;
  if (isClient.value && auth.fbUser?.displayName?.trim()) {
    return auth.fbUser.displayName.trim();
  }
  return "Client";
});

// Resolved photo URLs — same fallback chain as the names above.
// Tradies are public (tradieInfo carries their photoURL when loaded
// for client viewers); clients aren't, so the client-side photo only
// comes from the denormalized job field OR the auth profile of the
// signed-in client. Anything missing falls back to null and the
// downstream Avatar component renders initials instead.
const resolvedTradespersonPhotoURL = computed<string | null>(() => {
  const denorm = job.value?.tradespersonPhotoURL ?? null;
  if (denorm) return denorm;
  if (isTradie.value && auth.fbUser?.photoURL) return auth.fbUser.photoURL;
  const fromTradieDoc = tradieInfo.value?.photoURL ?? null;
  if (fromTradieDoc) return fromTradieDoc;
  return null;
});

const resolvedClientPhotoURL = computed<string | null>(() => {
  const denorm = job.value?.clientPhotoURL ?? null;
  if (denorm) return denorm;
  if (isClient.value && auth.fbUser?.photoURL) return auth.fbUser.photoURL;
  return null;
});

// Counterparty (the other party from the viewer's perspective). The
// review banner + modal both display this person.
const counterpartyName = computed(() =>
  isClient.value ? resolvedTradespersonName.value : resolvedClientName.value,
);
const counterpartyPhotoUrl = computed<string | null>(() =>
  isClient.value ? resolvedTradespersonPhotoURL.value : resolvedClientPhotoURL.value,
);
const counterpartyInitials = computed(() => {
  const parts = counterpartyName.value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

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
      // Nudge the tradie to set a date once the job is active and there
      // isn't one yet.
      badge:
        isTradie.value && s === "in_progress" && !job.value.scheduledStart
          ? "dot"
          : undefined,
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
// Seeded + cleaned up from `?chat=open` so a click on a message_received
// notification can land the user directly in the chat thread instead of
// making them hunt for the button after the page loads. `immediate: true`
// covers the cold-mount case (the watcher otherwise only fires on later
// route changes); the recursive replace ends after one pass because the
// `chat` key is gone on the second tick.
const chatOverlayOpen = ref(false);
watch(
  () => route.query.chat,
  (v) => {
    if (v !== "open") return;
    chatOverlayOpen.value = true;
    const next = { ...route.query };
    delete next.chat;
    router.replace({ query: next });
  },
  { immediate: true },
);

// Mutual-review deep link. Bell-icon clicks on review_* notifications
// land here with `?review=1`; we bump a counter so MutualReviewCard's
// watcher fires (it auto-opens the dialog on signal change). Counter
// rather than a flag so the second visit re-opens — a flag would
// silently no-op when ?review=1 stayed set across navigations.
const reviewAutoOpenSignal = ref(0);
watch(
  () => route.query.review,
  (v) => {
    if (v !== "1") return;
    reviewAutoOpenSignal.value += 1;
    // Strip the query so a back+forward navigation doesn't auto-re-open
    // forever. The signal is what drives the modal; the URL is just the
    // transport, and it's served its purpose.
    const next = { ...route.query };
    delete next.review;
    router.replace({ query: next });
  },
  { immediate: true },
);

// Sticky bottom CTA: tradie's primary action for the current status. Drives
// the bottom padding on the section (so content isn't hidden behind the
// fixed bar) and the bar's visibility. Stays visible across every tab —
// the bar gets thinner on mobile so the chat composer can sit comfortably
// above it.
// Every tradesperson-actionable step in the loop gets a sticky CTA so
// "what's next" is never buried in a tab. `awaiting_client_approval` is
// the one wait-state we intentionally skip — the InvoiceTab already
// renders the explainer card, and there's no tradie action to take.
const stickyCTAStatuses: ReadonlySet<JobStatus> = new Set([
  "requested",
  "quoted",
  "awaiting_upfront_payment",
  "in_progress",
  "awaiting_payment",
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
    // The job doc rides a live subscription so status changes from the other
    // party (e.g. client accepts a quote) update the banners + sticky CTA
    // without a manual refresh. The heavier dependent reads (intake schema,
    // invoice, private notes, tradie info) and the editable drafts run ONCE
    // on the first snapshot — re-running them on every snapshot would both
    // waste reads and clobber in-progress edits (intake draft, notes).
    let firstSnapshot = true;
    unsubscribeJob?.();
    unsubscribeJob = subscribeJob(
      id,
      (j) => {
        job.value = j;
        if (!firstSnapshot) return;
        firstSnapshot = false;
        if (!j) {
          loading.value = false;
          return;
        }
        void loadJobDependents(j)
          .catch((e) => {
            loadError.value = humanizeError(e);
            job.value = null;
          })
          .finally(() => {
            loading.value = false;
            void maybeAutoUpdateLog();
          });
      },
      (e) => {
        console.warn(
          "[JobDetailView] subscription failed",
          { jobId: id, signedInAs: auth.fbUser?.uid ?? null },
          e,
        );
        loadError.value = humanizeError(e);
        job.value = null;
        loading.value = false;
      },
    );
  } catch (e) {
    console.warn(
      "[JobDetailView] read failed",
      { jobId: route.params.id, signedInAs: auth.fbUser?.uid ?? null },
      e,
    );
    loadError.value = humanizeError(e);
    job.value = null;
    loading.value = false;
  }
}

// One-time dependent loads keyed off the resolved job. Kept separate from the
// live job subscription so it runs exactly once per mount (see load()).
async function loadJobDependents(j: WithId<JobDoc>) {
  const [remote, invoice] = await Promise.all([
    getIntakeSchema(j.trade),
    getInvoiceByJobId(j.id),
  ]);
  intakeFields.value = remote?.fields ?? SEED_INTAKE_SCHEMAS[j.trade] ?? [];
  invoiceId.value = invoice?.id ?? null;
  invoicePayable.value = !!invoice?.payment?.clientSecret;

  scheduledStart.value = j.scheduledStart?.toDate() ?? null;
  scheduledEnd.value = j.scheduledEnd?.toDate() ?? null;
  // Private notes live in a tradie-only subdoc; the client can't read it
  // (rules deny it), so only fetch when the viewer is the tradesperson.
  privateNotes.value = isTradie.value ? await getJobPrivateNotes(j.id) : "";
  intakeDraft.value = { ...(j.intakeFormData ?? {}) };

  // Clients see a "Your tradesperson" panel — fetch the tradesperson doc
  // so we can render their photo + badges. Read can fail gracefully when
  // the tradie has gone invisible (suspended/de-listed): rules require
  // isVisible:true for non-owners. The panel falls back to a generic
  // "your tradesperson" display when tradieInfo stays null.
  if (isClient.value) {
    try {
      tradieInfo.value = await getTradesperson(j.tradespersonId);
    } catch {
      tradieInfo.value = null;
    }
  } else {
    tradieInfo.value = null;
  }
}

onMounted(load);

// Subscribe to the mutual-review pair as soon as we know the jobId.
// JobDetailView owns this (not InvoiceTab) so the top-of-page banner
// can react to pair state even when the user is on a different tab.
// The watch starts immediately on first load and re-binds if the
// route changes to a different job (rare but possible via in-app
// navigation).
watch(
  () => route.params.id,
  (id) => {
    unsubscribeReviewPair?.();
    unsubscribeReviewPair = null;
    reviewPair.value = null;
    if (typeof id !== "string" || !id) return;
    unsubscribeReviewPair = subscribeReviewPair(id, (p) => {
      reviewPair.value = p;
    });
  },
  { immediate: true },
);

onUnmounted(() => {
  unsubscribeReviewPair?.();
  unsubscribeReviewPair = null;
  unsubscribeJob?.();
  unsubscribeJob = null;
});

// Banner state — only derived once both job + pair are loaded. We
// surface the banner only when the user actually has work to do
// (needs to leave a review) OR when both reviews just became visible
// (so they don't miss it). "Waiting on the other side" is a passive
// state — no banner, the InvoiceTab card handles it.
const isJobInReviewPhase = computed(
  () => job.value?.status === "complete" || job.value?.status === "reviewed",
);

const mySubmittedAt = computed(() => {
  const p = reviewPair.value;
  if (!p) return null;
  if (isClient.value) return p.clientSubmittedAt;
  if (isTradie.value) return p.tradieSubmittedAt;
  return null;
});

const reviewBannerVariant = computed<"needsReview" | "waiting" | null>(() => {
  if (!isJobInReviewPhase.value) return null;
  const p = reviewPair.value;
  // Pair hasn't loaded or doesn't exist yet — but the job IS in the
  // review phase, so still nudge the user to leave a review. The
  // MutualReviewCard mounted below falls back to a plain prompt in
  // that case and our CTA routes them there.
  if (!p) return "needsReview";
  // Once revealed, the MutualReviewCard rendered alongside this banner
  // surfaces the actual review content inline — no separate "Reviews
  // are live" banner needed (it would be a second click to reach the
  // same content the card already shows).
  if (p.revealedAt) return null;
  if (!mySubmittedAt.value && !p.locked) return "needsReview";
  // I submitted, the other side hasn't, deadline hasn't passed —
  // surface a passive "waiting" indicator (no CTA). Avoids the
  // user assuming nothing happened after they hit Submit.
  if (mySubmittedAt.value && !p.locked) return "waiting";
  return null;
});

// Drives the always-mounted MutualReviewCard above the tabs. Once the
// job hits complete/reviewed the card is on the page (it owns its own
// "is there anything to show" gate: revealed reviews + locked-out
// fallback + the invisible dialog host). Keeping the mount above the
// tab bar means the user lands on the actual reviews the moment they
// open the job — no clicking through to the Invoice tab.
const shouldMountReviewCard = computed(() => isJobInReviewPhase.value);

const reviewDaysLeft = computed(() => {
  const p = reviewPair.value;
  if (!p) return null;
  const ms = p.deadlineAt.toDate().getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
});

// Banner "Leave a review" CTA → switch to Invoice tab AND bump the
// auto-open signal so MutualReviewCard pops the dialog as soon as it
// mounts. Only meaningful when the user can still submit; revealed
// state uses scrollToReviews instead because the signal-driven open is
// guarded by canStillSubmit and would silently no-op.
function openReviewFromBanner() {
  reviewAutoOpenSignal.value += 1;
  if (route.query.tab !== "invoice") {
    router.replace({ query: { ...route.query, tab: "invoice" } });
  }
}


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
      privateNotes.value = await getJobPrivateNotes(job.value.id);
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
      privateNotes.value = await getJobPrivateNotes(job.value.id);
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

async function onMarkUpfrontPaid() {
  if (!job.value || markingUpfront.value) return;
  markingUpfront.value = true;
  try {
    await markUpfrontFeePaid(job.value.id);
    toast.success("Upfront fee confirmed", "Job is now active — you're clear to start.");
    await load();
  } catch (e) {
    toast.error("Couldn't mark paid", humanizeError(e));
  } finally {
    markingUpfront.value = false;
  }
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
    style="--job-topbar-h: 2.75rem"
  >
    <!-- Sticky Back bar. The JobTabBar below docks directly beneath it (its
         sticky top is set to this bar's height via --job-topbar-h). -->
    <div class="job-detail__topbar">
      <button type="button" class="job-detail__back" @click="goBack">
        <i class="pi pi-arrow-left" aria-hidden="true"></i>
        <span>Back</span>
      </button>
      <!-- Status lives in the top bar (not next to the title) so the title
           gets the full width below. -->
      <Tag
        v-if="job"
        :value="STATUS_LABEL[job.status]"
        :severity="STATUS_SEVERITY[job.status]"
        class="ml-1 shrink-0"
      />
    </div>

    <LoadingState v-if="loading" class="mt-4" />
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
      <header class="mt-1 mb-3">
        <h1 class="text-xl font-bold break-words leading-tight">{{ job.title }}</h1>
        <div class="text-[11px] text-[color:var(--bs-muted)] mt-0.5 truncate">
          {{ tradeLabel(job.trade) }} · {{ job.address.line1 }}, {{ job.address.city }}
        </div>
      </header>

      <!-- Mutual-review banner: top-of-page surface for the review loop.
           Three variants:
             needsReview — amber, primary "Leave [name] a review" CTA
             waiting     — slate, passive "Waiting on [name]" indicator
             revealed    — emerald, secondary "See reviews" → Invoice tab
           All three show the counterparty's avatar + name so the user
           recognises who they're being asked about at a glance. -->
      <div
        v-if="reviewBannerVariant === 'needsReview'"
        class="bs-card p-4 mb-4 border-l-4 border-l-amber-500"
      >
        <div class="flex items-start gap-3">
          <Avatar
            v-if="counterpartyPhotoUrl"
            :image="counterpartyPhotoUrl"
            shape="circle"
            size="large"
          />
          <Avatar
            v-else
            :label="counterpartyInitials"
            shape="circle"
            size="large"
            class="!bg-amber-100 !text-amber-700 font-semibold"
          />
          <div class="flex-1 min-w-0">
            <div class="font-semibold">Leave {{ counterpartyName }} a review</div>
            <p class="text-sm text-[color:var(--bs-muted)] mt-1">
              Hidden until they review you back.<template v-if="reviewDaysLeft !== null && reviewDaysLeft > 0">
                {{ " " }}{{ reviewDaysLeft }} day{{ reviewDaysLeft === 1 ? "" : "s" }} left.
              </template>
            </p>
            <Button
              :label="`Leave ${counterpartyName} a review`"
              icon="pi pi-star"
              class="mt-3"
              @click="openReviewFromBanner"
            />
          </div>
        </div>
      </div>

      <div
        v-else-if="reviewBannerVariant === 'waiting'"
        class="bs-card p-4 mb-4 border-l-4 border-l-slate-400"
      >
        <div class="flex items-start gap-3">
          <Avatar
            v-if="counterpartyPhotoUrl"
            :image="counterpartyPhotoUrl"
            shape="circle"
            size="large"
          />
          <Avatar
            v-else
            :label="counterpartyInitials"
            shape="circle"
            size="large"
            class="!bg-slate-100 !text-slate-600 font-semibold"
          />
          <div class="flex-1 min-w-0">
            <div class="font-semibold">Waiting on {{ counterpartyName }}</div>
            <p class="text-sm text-[color:var(--bs-muted)] mt-1">
              Your review is in. Once they submit theirs, both go live.<template v-if="reviewDaysLeft !== null && reviewDaysLeft > 0">
                {{ " " }}{{ reviewDaysLeft }} day{{ reviewDaysLeft === 1 ? "" : "s" }} left.
              </template>
            </p>
          </div>
        </div>
      </div>

      <!-- Mutual review card sits in the banner area so revealed reviews
           land right at the top of every tab. Pre-reveal it renders
           nothing visible (the action banners above handle that state)
           but still hosts the ReviewPrompt dialog so the "Leave a
           review" CTA can pop the modal. Post-reveal it shows both
           reviews stacked. -->
      <MutualReviewCard
        v-if="shouldMountReviewCard"
        :job="job"
        :is-client="isClient"
        :is-tradie="isTradie"
        :counterparty-name="counterpartyName"
        :counterparty-photo-url="counterpartyPhotoUrl"
        :auto-open-signal="reviewAutoOpenSignal"
        class="mb-4"
        @reviewed="load"
      />

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

      <UpfrontFeePaymentBanner
        v-if="job.status === 'awaiting_upfront_payment' && job.upfrontFee"
        :job="job"
        :is-client="isClient"
        :is-tradie="isTradie"
        :payment-instructions="tradieInfo?.paymentInstructions ?? null"
        class="mb-4"
        @marked="load"
      />

      <ClientApprovalBanner
        v-if="isClient && job.status === 'awaiting_client_approval'"
        :job-id="job.id"
        class="mb-4"
        @decided="load"
      />

      <!-- Changes-requested loopback. Mirrors the quote decline -> revise
           pattern: tradie sees the change reason + an "Update invoice"
           CTA; client sees a passive "waiting on revised invoice" stub.
           Driven by clientChangesRequestedAt on the job — set by
           clientRequestChanges, cleared again by submitJobForApproval. -->
      <TradieChangesRequestedBanner
        v-if="job.status === 'in_progress' && job.clientChangesRequestedAt"
        :job="job"
        :is-tradie="isTradie"
        :is-client="isClient"
        class="mb-4"
        @update-invoice="showFinishSheet = true"
      />

      <!-- Active-job booking confirmation. Once a date is set on an
           active job, the booking is the most important piece of info
           on the page — surface it in the banners rail rather than
           burying it inside the Schedule tab. Same banner copy for
           both roles since it's a shared agreement. -->
      <div
        v-if="job.status === 'in_progress' && job.scheduledStart"
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
          :updating-log="updatingLog"
          @submit-brief="submitBrief"
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
          :invoice-payable="invoicePayable"
          :marking-paid="markingPaid"
          :resolved-tradesperson-name="resolvedTradespersonName"
          :resolved-client-name="resolvedClientName"
          @mark-paid="onMarkPaid"
          @revise-quote="showQuoteSheet = true"
          @paid="load"
        />
      </div>

      <!-- Chat + AI lives in a bottom-anchored overlay rather than as a
           tab. The composer never has to share the bottom edge with the
           sticky CTA, and the AI assistant rides along as a sub-tab. -->
      <JobChatButton
        :chat-id="job.chatId"
        :lift-for-cta="showStickyCTA"
        :is-tradie="isTradie"
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
         while the user browses other surfaces.
         `left:` reads `--bs-content-left-offset` from AppShell so the bar
         starts after the side panel on desktop (260px) instead of running
         underneath it. On mobile the var is 0 and `mobileCompact` hides
         the bottom nav, so the bar can sit flush at the viewport edge. -->
    <div
      v-if="showStickyCTA && job"
      class="fixed right-0 bottom-0 z-30 border-t border-[color:var(--bs-border)] bg-white/95 backdrop-blur p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-2px_8px_rgba(0,0,0,0.04)]"
      style="left: var(--bs-content-left-offset, 0px);"
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
          v-else-if="job.status === 'awaiting_upfront_payment'"
          :label="job.upfrontFee ? `Mark upfront received — ${money(job.upfrontFee.amountCents)}` : 'Mark upfront received'"
          icon="pi pi-check"
          severity="success"
          class="w-full"
          size="large"
          :loading="markingUpfront"
          @click="onMarkUpfrontPaid"
        />
        <Button
          v-else-if="job.status === 'in_progress'"
          :label="job.clientChangesRequestedAt ? 'Update invoice' : 'Create invoice'"
          :icon="job.clientChangesRequestedAt ? 'pi pi-pencil' : 'pi pi-receipt'"
          class="w-full"
          size="large"
          @click="showFinishSheet = true"
        />
        <Button
          v-else-if="job.status === 'awaiting_payment'"
          label="Mark as paid"
          icon="pi pi-wallet"
          severity="success"
          class="w-full"
          size="large"
          :loading="markingPaid"
          @click="onMarkPaid"
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
      <!-- Upfront fee warning. Refunds aren't tracked in the data model
           (deferred to v1.1, per design.md), so flag the manual settlement
           obligation before the user commits — they'd otherwise cancel
           thinking platform owes them the refund. -->
      <div
        v-if="job?.upfrontFee?.paidAt"
        class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 mb-3"
      >
        <i class="pi pi-exclamation-triangle text-amber-700 mr-1"></i>
        This job already has a
        <span class="font-semibold">{{ money(job.upfrontFee.amountCents) }}</span>
        upfront fee paid. Refunds are handled outside Blue Seal —
        coordinate that with the {{ isClient ? "tradesperson" : "client" }} before cancelling.
      </div>
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
/* Sticky top bar holding the Back action (the bottom nav is hidden on this
   route, so Back is the primary way out). Full-bleed white so content scrolls
   cleanly underneath it; the JobTabBar docks flush beneath via --job-topbar-h. */
.job-detail__topbar {
  position: sticky;
  top: 0;
  z-index: 21;
  height: var(--job-topbar-h, 2.75rem);
  display: flex;
  align-items: center;
  background: white;
  margin-inline: -1rem;
  padding-inline: 0.5rem;
}
.job-detail__back {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  border: 0;
  background: transparent;
  border-radius: 0.5rem;
  color: var(--bs-blue);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
}
.job-detail__back:hover {
  background: var(--bs-surface-alt);
}

/* When the fixed status CTA bar is shown, reserve its height at the bottom of
   the page so the last row of content (and the tab content) isn't trapped
   underneath it. Bar ≈ large button (3rem) + 0.75rem top padding + bottom
   safe-area padding; reserve a touch more. AppShell zeroes its own bottom-nav
   reserve on this mobileCompact route, so this is the only bottom reservation
   and doesn't double up. */
.job-detail--cta-on {
  padding-bottom: calc(80px + env(safe-area-inset-bottom));
}
</style>
