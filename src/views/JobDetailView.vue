<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import Menu from "primevue/menu";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
import Dialog from "primevue/dialog";
import DatePicker from "primevue/datepicker";
import Avatar from "primevue/avatar";
import {
  INSTANT_CANCEL_STATUSES,
  REQUEST_CANCEL_STATUSES,
  POSTPONABLE_STATUSES,
  cancelJob,
  requestJobChange,
  subscribeJob,
  getJobPrivateNotes,
  markJobPaid,
  markUpfrontFeePaid,
  updatePrivateNotes,
  saveJobIntake,
  saveJobIntakeAndAdvance,
} from "@/firebase/services/jobs";
import {
  subscribeJobSessions,
  createSession,
  updateSession,
  deleteSession,
} from "@/firebase/services/sessions";
import { returnToApplicants } from "@/firebase/services/jobPosts";
import { updateJobLog } from "@/firebase/services/assistant";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { getInsuranceWaiver, signUninsuredWaiver } from "@/firebase/services/insuranceWaivers";
import { findCollisions, type Collision } from "@/firebase/services/bookings";
import { useConfirm } from "primevue/useconfirm";
import { createManualInvoice, getInvoiceByJobId } from "@/firebase/services/invoices";
import { subscribeReviewPair } from "@/firebase/services/reviews";
import { subscribeJobExtras } from "@/firebase/services/jobExtras";
import { subscribeSiteVisit } from "@/firebase/services/siteVisits";
import { useAuthStore } from "@/stores/auth";
import { usePaywallStore } from "@/stores/paywall";
import type {
  JobDoc,
  JobExtraDoc,
  JobStatus,
  InsuranceWaiverDoc,
  InvoiceStatus,
  ReviewPairDoc,
  SessionDoc,
  SiteVisitDoc,
  TimeEntryKind,
  TradespersonDoc,
  WithId,
} from "@/firebase/interfaces";
import { isTradieInsured } from "@/utils/insuranceStatus";
import { useFormatters } from "@/composables/useFormatters";
import FinishJobSheet from "@/components/FinishJobSheet.vue";
import ClientApprovalBanner from "@/components/ClientApprovalBanner.vue";
import InviteStatusBanner from "@/components/InviteStatusBanner.vue";
import RecordOfflineAcceptanceBanner from "@/components/RecordOfflineAcceptanceBanner.vue";
import QuoteTab from "@/features/jobDetail/QuoteTab.vue";
import ClientQuoteApprovalBanner from "@/components/ClientQuoteApprovalBanner.vue";
import UpfrontFeePaymentBanner from "@/components/UpfrontFeePaymentBanner.vue";
import TradieChangesRequestedBanner from "@/components/TradieChangesRequestedBanner.vue";
import MutualReviewCard from "@/components/MutualReviewCard.vue";
import JobChangeBanner from "@/components/JobChangeBanner.vue";
import JobStatusTimeline from "@/components/JobStatusTimeline.vue";
import ProposedChangeOrderBanner from "@/components/ProposedChangeOrderBanner.vue";
import ProposedSiteVisitBanner from "@/components/ProposedSiteVisitBanner.vue";
import UninsuredWaiverDialog from "@/components/UninsuredWaiverDialog.vue";
import ReportJobProblemDialog from "@/components/jobDetail/ReportJobProblemDialog.vue";
import { SEED_INTAKE_SCHEMAS } from "@/data/intakeSchemas";
import { firstMissingRequired } from "@/utils/intake";
import { getIntakeSchema } from "@/firebase/services/intakeFormSchemas";
import type { IntakeField } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { useActiveClock } from "@/composables/useActiveClock";
import { clockIn, clockOut, formatElapsed } from "@/firebase/services/timeEntries";
import { humanizeError, isPaywallError } from "@/utils/errors";
import { statusLabel, STATUS_SEVERITY } from "@/utils/jobStatus";
import { jobBillingType } from "@/utils/jobBilling";
import JobTabBar, { type JobTab } from "@/features/jobDetail/JobTabBar.vue";
import BriefTab from "@/features/jobDetail/BriefTab.vue";
import ScheduleTab from "@/features/jobDetail/ScheduleTab.vue";
import WorkOrderTab from "@/features/jobDetail/WorkOrderTab.vue";
import InvoiceTab from "@/features/jobDetail/InvoiceTab.vue";
import JobChatButton from "@/features/jobDetail/JobChatButton.vue";
import JobChatOverlay from "@/features/jobDetail/JobChatOverlay.vue";
import LoadingState from "@/components/LoadingState.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const paywall = usePaywallStore();
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
// The tradesperson's OWN doc + this job's uninsured-work waiver, loaded only for
// the tradesperson viewer. Drive the "sign before you start" gate. `tradieInfo`
// above is the client-side mirror; this is the owner read of the same fields.
const myTradieDoc = ref<WithId<TradespersonDoc> | null>(null);
const waiver = ref<WithId<InsuranceWaiverDoc> | null>(null);
const showWaiverDialog = ref(false);
const signingWaiver = ref(false);
const reviewPair = ref<WithId<ReviewPairDoc> | null>(null);
// Live subscription to the job's change orders. Owned here so the Work Order
// tab badge + the client's approval banner react from any tab.
const jobExtras = ref<WithId<JobExtraDoc>[]>([]);
let unsubscribeExtras: (() => void) | null = null;
const proposedExtras = computed(() => jobExtras.value.filter((e) => e.status === "proposed"));
// Live subscription to the pre-quote "site visit first" agreement (one per job).
// Owned here so the client's agree/decline banner shows from any tab.
const siteVisit = ref<WithId<SiteVisitDoc> | null>(null);
let unsubscribeSiteVisit: (() => void) | null = null;
const proposedSiteVisit = computed(() =>
  siteVisit.value?.status === "proposed" ? siteVisit.value : null,
);
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
// Status of that invoice. Needed alongside the id because a DRAFT invoice is
// the tradesperson's private working copy — with manual invoices they can be
// drafting mid-job, so the client-facing card can no longer render on the mere
// existence of an invoice doc.
const invoiceStatus = ref<InvoiceStatus | null>(null);
// createManualInvoice in flight (the Invoice tab's "New invoice" button).
const creatingInvoice = ref(false);
// True when the tradesperson can accept a card payment — i.e. their Connect
// payouts are enabled. The PaymentIntent is now created at pay time (when the
// client opens /invoices/:id/pay), so we can't key off clientSecret anymore;
// instead we read the tradie's public payouts state. When false, the client
// only gets the fee-free offline path (mark-as-paid).
const invoicePayable = computed(() => tradieInfo.value?.payouts?.payoutsEnabled === true);
const loading = ref(true);
// When the URL points at a job the signed-in user can't read (notification
// pointing at a stale or wrong id, deep link from another account) the
// service throws permission-denied. Catch it here so the view shows a
// useful empty state instead of hanging on "Loading…" forever.
const loadError = ref<string | null>(null);

// Booked work sessions for this job (live-subscribed). A job can have many;
// the job's scheduledStart/End mirror is kept in sync server-path-side by the
// sessions service, so the banners + dashboard keep reading the single window.
const sessions = ref<WithId<SessionDoc>[]>([]);
let unsubscribeSessions: (() => void) | null = null;
const privateNotes = ref("");

const updatingLog = ref(false);

const intakeDraft = ref<Record<string, unknown>>({});
const savingIntake = ref(false);
const returningToApplicants = ref(false);

const showCancelDialog = ref(false);
const cancelReason = ref("");
const cancelling = ref(false);

// Postpone (put-on-hold) request dialog. Reason is required (so the
// tradesperson understands why); the resume date is an optional hint.
const showPostponeDialog = ref(false);
const postponeReason = ref("");
const postponeResumeDate = ref<Date | null>(null);
const postponing = ref(false);

const collisions = ref<Collision[]>([]);
const showCollisionDialog = ref(false);
const savingSession = ref(false);
// The session waiting on a collision decision. null ⇒ create, set id ⇒ update.
const pendingSession = ref<{
  sessionId: string | null;
  start: Date;
  end: Date;
  note: string;
} | null>(null);

const showFinishSheet = ref(false);
const markingPaid = ref(false);
const markingUpfront = ref(false);

const isTradie = computed(() => auth.fbUser?.uid === job.value?.tradespersonId);
const isClient = computed(() => auth.fbUser?.uid === job.value?.clientId);

// Quick labour clock-in/out from the header. The full Work Order tab handles
// travel + change-order sessions; the header is the one-tap common case.
const {
  activeEntry: clockEntry,
  elapsedMs: clockElapsedMs,
  isRunningOn: clockRunningOn,
} = useActiveClock();
const clockBtnBusy = ref(false);

// What the tradie can start a session against from the header clock-in. Rates
// come from their own profile (labour/travel) and each approved hourly change
// order — mirrors the server-side rate resolution in clockIn.ts.
interface ClockChoice {
  kind: TimeEntryKind;
  extraId?: string;
  label: string;
  rateCents: number | null; // null ⇒ fixed-job labour: time-only, no charge
}

const jobBilling = computed(() => jobBillingType(job.value));
const approvedHourlyExtras = computed(() =>
  jobExtras.value
    .filter((e) => e.status === "approved" && e.billingType === "hourly")
    .map((e) => ({ id: e.id, description: e.description, rateCents: e.hourlyRateCents ?? 0 })),
);

const clockChoices = computed<ClockChoice[]>(() => {
  const fixed = jobBilling.value === "fixed";
  const profileHourly = myTradieDoc.value?.hourlyRate ?? 0;
  const travel = myTradieDoc.value?.travelRate ?? 0;
  const choices: ClockChoice[] = [
    { kind: "labour", label: "Labour", rateCents: fixed ? null : profileHourly },
  ];
  // Travel bills only on hourly jobs, falling back to the labour rate.
  if (!fixed) {
    choices.push({
      kind: "travel",
      label: "Travel",
      rateCents: travel > 0 ? travel : profileHourly,
    });
  }
  for (const ex of approvedHourlyExtras.value) {
    choices.push({ kind: "extra", extraId: ex.id, label: ex.description, rateCents: ex.rateCents });
  }
  return choices;
});

const labourChoice = computed(() => clockChoices.value[0]);
function rateText(rateCents: number | null): string {
  return rateCents == null ? "Time only — no charge" : `${money(rateCents)}/hr`;
}
const labourRateText = computed(() => rateText(labourChoice.value.rateCents));

// Every clock option (labour + travel + approved hourly change orders) as a
// popup-menu model. When there's more than one, the header clock-in opens this
// menu rather than silently defaulting to labour — so travel / change-order
// options are discoverable instead of hidden behind a caret the tradie may
// never notice. A single option (labour only) skips the menu entirely.
const clockMenuItems = computed(() =>
  clockChoices.value.map((c) => ({
    label: `${c.label} · ${rateText(c.rateCents)}`,
    icon:
      c.kind === "travel" ? "pi pi-car" : c.kind === "extra" ? "pi pi-plus-circle" : "pi pi-play",
    command: () => startClock(c),
  })),
);
const clockMenu = ref<InstanceType<typeof Menu> | null>(null);
function openClockMenu(e: Event) {
  clockMenu.value?.toggle(e);
}

// What's currently on the clock — kind + rate for the header stop control.
const runningKindLabel = computed(() => {
  const e = clockEntry.value;
  if (!e) return "";
  if (e.kind === "travel") return "Travel";
  if (e.kind === "extra") {
    return (
      approvedHourlyExtras.value.find((x) => x.id === e.extraId)?.description ?? "Change order"
    );
  }
  return "Labour";
});
const runningRateText = computed(() => {
  const e = clockEntry.value;
  if (!e || e.hourlyRateSnapshot <= 0) return "";
  return `${money(e.hourlyRateSnapshot)}/hr`;
});

async function startClock(choice: ClockChoice) {
  if (clockBtnBusy.value || !job.value) return;
  // Uninsured tradies must sign the waiver first — open it instead of clocking
  // in. The clockIn callable enforces the same gate server-side.
  if (needsUninsuredWaiver.value) {
    showWaiverDialog.value = true;
    return;
  }
  clockBtnBusy.value = true;
  try {
    await clockIn(job.value.id, { kind: choice.kind, extraId: choice.extraId ?? null });
    toast.success("Clocked in", choice.kind === "labour" ? undefined : choice.label);
  } catch (e) {
    toast.error("Couldn't clock in", humanizeError(e));
  } finally {
    clockBtnBusy.value = false;
  }
}

// Sign the uninsured-work waiver. This only records the waiver — it does NOT
// start the timer. Once signed, needsUninsuredWaiver flips false and the header
// button becomes a plain "Clock in", so the tradesperson starts the clock with
// a deliberate second tap rather than signing auto-starting it.
async function onSignWaiver(signatureDataUrl: string) {
  if (signingWaiver.value || !job.value) return;
  signingWaiver.value = true;
  try {
    await signUninsuredWaiver(job.value.id, signatureDataUrl);
    waiver.value = await getInsuranceWaiver(job.value.id);
    showWaiverDialog.value = false;
    toast.success("Waiver signed", "You're cleared to start. Tap Clock in when you're ready.");
  } catch (e) {
    toast.error("Couldn't sign the waiver", humanizeError(e));
  } finally {
    signingWaiver.value = false;
  }
}

async function onHeaderClockOut() {
  const entry = clockEntry.value;
  if (clockBtnBusy.value || !entry) return;
  clockBtnBusy.value = true;
  try {
    await clockOut(entry.jobId, entry.id);
    toast.success("Clocked out");
  } catch (e) {
    toast.error("Couldn't clock out", humanizeError(e));
  } finally {
    clockBtnBusy.value = false;
  }
}

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

// Client "change of plans" capabilities. Mutually exclusive across the
// pre-commitment vs committed phases, and all suppressed once a request is
// already in flight (the JobChangeBanner takes over). `on_hold` is in none of
// the status sets, so a held job offers only Resume (via the banner).
const hasPendingChange = computed(() => job.value?.pendingChange != null);

const canInstantCancel = computed(
  () =>
    isClient.value &&
    !hasPendingChange.value &&
    job.value != null &&
    (INSTANT_CANCEL_STATUSES as readonly string[]).includes(job.value.status),
);

const canRequestCancel = computed(
  () =>
    isClient.value &&
    !hasPendingChange.value &&
    job.value != null &&
    (REQUEST_CANCEL_STATUSES as readonly string[]).includes(job.value.status),
);

const canRequestPostpone = computed(
  () =>
    isClient.value &&
    !hasPendingChange.value &&
    job.value != null &&
    (POSTPONABLE_STATUSES as readonly string[]).includes(job.value.status),
);

// True when the open cancel dialog is for a committed job — copy + action
// switch from an instant cancel to a "send a request" flow.
const cancelNeedsApproval = computed(() => canRequestCancel.value);

const now = Date.now();
// Client-side view of the tradesperson's liability insurance (public mirror).
// Routed through the shared helper so "insured" means the same everywhere.
const tradieInsuranceLive = computed(() => isTradieInsured(tradieInfo.value, now));

// Tradesperson gate: their own liability insurance is not current AND they
// haven't yet signed this job's uninsured-work waiver. Matched by the clockIn
// callable's server-side guard. Tied to the active state where work happens
// (in_progress), which is also when the header clock-in button shows.
const needsUninsuredWaiver = computed(
  () =>
    isTradie.value &&
    job.value?.status === "in_progress" &&
    !isTradieInsured(myTradieDoc.value, now) &&
    !waiver.value?.tradesperson,
);
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
      badge: isTradie.value && s === "in_progress" && !job.value.scheduledStart ? "dot" : undefined,
    },
    // Tradesperson-only: quoting is their action, and the client already sees
    // the quote itself on the Invoice tab. Sits before Work order because it
    // comes before the work. Optional by design — see QuoteTab's header
    // comment and issues #19 / #22.
    ...(isTradie.value
      ? [
          {
            key: "quote",
            label: "Quote",
            icon: "pi-file-edit",
            // The nudge the removed "Quote needed" Tag used to carry.
            badge: s === "requested" ? ("dot" as const) : undefined,
          },
        ]
      : []),
    {
      key: "workorder",
      label: "Work order",
      icon: "pi-wrench",
      // Nudge the client when a change order is waiting on their approval.
      badge: isClient.value && proposedExtras.value.length > 0 ? "dot" : undefined,
    },
    {
      key: "invoice",
      label: "Invoice",
      icon: "pi-receipt",
      badge: s === "awaiting_client_approval" || s === "awaiting_payment" ? "dot" : undefined,
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

// Wrap-up deep link. The jobs-list action menu's "Complete job" (issue #21)
// routes here with `?finish=1` rather than reimplementing the flow on the
// dashboard, so there stays one wrap-up sheet. Same shape as `?chat=open`
// above: gated on isTradie + in_progress so a stale/hand-typed link can't pop
// a sheet that submitJobForApproval would reject anyway, and the key is
// stripped so a back-navigation doesn't re-open it.
watch(
  [() => route.query.finish, () => job.value?.status],
  ([v, status]) => {
    if (v !== "1") return;
    // The immediate tick runs before load() resolves, so `job` is still null.
    // Stripping the key there would eat the deep link before it could fire —
    // wait for the job, then decide.
    if (!status) return;
    if (isTradie.value && status === "in_progress") showFinishSheet.value = true;
    const next = { ...route.query };
    delete next.finish;
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
// "what's next" is never buried in a tab. The skips are all "this step has its
// own home, and a full-width bar overstates it": `awaiting_client_approval`
// (wait-state — the InvoiceTab explains it), `in_progress` (Create invoice
// lives ONLY in the Invoice tab, so the invoice gets made where invoices
// live), and `requested` / `quoted` — quoting lives on the Quote tab now. The
// sticky "Prepare quote" bar was the single loudest reason quoting read as
// mandatory (issues #19, #22), so the money steps keep the bar and the
// optional one doesn't.
const stickyCTAStatuses: ReadonlySet<JobStatus> = new Set([
  "awaiting_upfront_payment",
  "awaiting_payment",
]);
// Moved off the sticky bar with the quote CTAs: only meaningful next to the
// quote form, which is where an agreed visit fee gets pre-filled.
const siteVisitAgreedNote = computed(() => {
  const v = siteVisit.value;
  if (!isTradie.value || v?.status !== "agreed") return null;
  const fee = v.fee.feeCents > 0 ? `${money(v.fee.feeCents)} fee` : "free visit";
  return `Site visit agreed — the ${fee} will be pre-filled into your quote.`;
});

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
  const [remote, invoice] = await Promise.all([getIntakeSchema(j.trade), getInvoiceByJobId(j.id)]);
  intakeFields.value = remote?.fields ?? SEED_INTAKE_SCHEMAS[j.trade] ?? [];
  invoiceId.value = invoice?.id ?? null;
  invoiceStatus.value = invoice?.status ?? null;

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

  // Tradesperson viewer: load their own doc (own insurance status) + this job's
  // uninsured-work waiver so the "sign before you start" gate can render.
  if (isTradie.value) {
    try {
      [myTradieDoc.value, waiver.value] = await Promise.all([
        getTradesperson(j.tradespersonId),
        getInsuranceWaiver(j.id),
      ]);
    } catch {
      myTradieDoc.value = null;
      waiver.value = null;
    }
  } else {
    myTradieDoc.value = null;
    waiver.value = null;
  }
}

// Single source of truth for "which job are we looking at". This watch owns
// the full (re)load: the main job subscription (via load()) AND the dependent
// subscriptions below. `immediate: true` covers the cold mount; re-running on
// route.params.id change is what makes in-app navigation between jobs work —
// e.g. clicking a notification for job B while already viewing job A. Without
// the re-run, Vue reuses this component instance, load() never fires again,
// and job.value (hence the chat overlay's chatId) stays stuck on the old job.
watch(
  () => route.params.id,
  (id) => {
    unsubscribeReviewPair?.();
    unsubscribeReviewPair = null;
    reviewPair.value = null;
    unsubscribeExtras?.();
    unsubscribeExtras = null;
    jobExtras.value = [];
    unsubscribeSiteVisit?.();
    unsubscribeSiteVisit = null;
    siteVisit.value = null;
    unsubscribeSessions?.();
    unsubscribeSessions = null;
    sessions.value = [];
    if (typeof id !== "string" || !id) return;
    // (Re)subscribe the main job doc + reload its dependents for this id.
    void load();
    unsubscribeReviewPair = subscribeReviewPair(id, (p) => {
      reviewPair.value = p;
    });
    unsubscribeExtras = subscribeJobExtras(id, (list) => {
      jobExtras.value = list;
    });
    unsubscribeSiteVisit = subscribeSiteVisit(id, (v) => {
      siteVisit.value = v;
    });
    // Sessions are read-authorized via the parent job, so both parties can
    // subscribe with just the id — no tradespersonId filter needed.
    unsubscribeSessions = subscribeJobSessions(id, (list) => {
      sessions.value = list;
    });
  },
  { immediate: true },
);

onUnmounted(() => {
  unsubscribeReviewPair?.();
  unsubscribeReviewPair = null;
  unsubscribeExtras?.();
  unsubscribeExtras = null;
  unsubscribeSiteVisit?.();
  unsubscribeSiteVisit = null;
  unsubscribeSessions?.();
  unsubscribeSessions = null;
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

// "Report a problem with this job" (P2-15): available to either party once the
// job is committed (a quote was accepted), so a client on a paid/completed job
// has a real route to raise an issue instead of only the generic Help link.
const showReportProblem = ref(false);
const canReportProblem = computed(() => {
  const s = job.value?.status;
  if (!s || !(isClient.value || isTradie.value)) return false;
  return ["in_progress", "awaiting_payment", "complete", "reviewed", "paid"].includes(s);
});

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

// Add or edit a booked visit. Runs collision detection first; on a clash we
// surface the existing schedule-conflict dialog and stash the pending session
// until the tradie decides ("Schedule anyway" → commitPendingSession). The job
// doc + sessions list are live-subscribed, so no manual reload is needed —
// the service re-syncs scheduledStart/End and the banners follow.
async function onSaveSession(payload: {
  sessionId: string | null;
  start: Date;
  end: Date;
  note: string;
}) {
  if (!job.value) return;
  pendingSession.value = payload;
  savingSession.value = true;
  try {
    const conflicts = await findCollisions(job.value.tradespersonId, payload.start, payload.end, {
      excludeJobId: job.value.id,
    });
    if (conflicts.length > 0) {
      collisions.value = conflicts;
      showCollisionDialog.value = true;
      return;
    }
    await commitPendingSession();
  } catch (e) {
    toast.error("Couldn't save visit", humanizeError(e));
  } finally {
    savingSession.value = false;
  }
}

async function commitPendingSession() {
  if (!job.value || !pendingSession.value) return;
  const p = pendingSession.value;
  try {
    if (p.sessionId) {
      await updateSession(job.value.id, p.sessionId, {
        start: p.start,
        end: p.end,
        note: p.note,
      });
    } else {
      await createSession(job.value.id, {
        tradespersonId: job.value.tradespersonId,
        clientId: job.value.clientId,
        start: p.start,
        end: p.end,
        note: p.note,
      });
    }
    showCollisionDialog.value = false;
    collisions.value = [];
    pendingSession.value = null;
    toast.success("Visit booked");
  } catch (e) {
    toast.error("Couldn't save visit", humanizeError(e));
  }
}

async function onDeleteSession(sessionId: string) {
  if (!job.value) return;
  try {
    await deleteSession(job.value.id, sessionId);
    toast.success("Visit removed");
  } catch (e) {
    toast.error("Couldn't remove visit", humanizeError(e));
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
    if (paywall.fromError(e)) return;
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
    // Auto-log is a silent background nicety. For non-Pro tradespeople it hits
    // the AI paywall every time — swallow that quietly (no popup: they didn't
    // ask for this; no scary console error). Real failures still warn.
    if (isPaywallError(e)) return;
    console.warn("auto-log failed", e);
  }
}

async function submitBrief() {
  if (!job.value || savingIntake.value) return;
  const missingDetail = firstMissingRequired(intakeFields.value, intakeDraft.value);
  if (missingDetail) {
    toast.error("Missing required field", `Please fill: ${missingDetail}`);
    return;
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

// The tradesperson filling the trade-specific brief in themselves (invite jobs
// have no client to do it, and phone bookings are scoped verbally). No required
// -field gate: they're the pro, and unlike the client's submit this doesn't
// advance the job, so a half-filled brief is a legitimate save.
async function saveBrief() {
  if (!job.value || savingIntake.value) return;
  savingIntake.value = true;
  try {
    await saveJobIntake(job.value.id, intakeDraft.value);
    toast.success("Details saved");
    await load();
  } catch (e) {
    toast.error("Couldn't save details", humanizeError(e));
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

// "New invoice" on the Invoice tab: mint a blank draft the tradesperson fills
// in themselves. Deliberately no confirm dialog — it's a private draft, and the
// callable is idempotent per job, so the worst case of a stray tap is an empty
// invoice they can edit or ignore.
async function onCreateManualInvoice() {
  if (!job.value || creatingInvoice.value) return;
  creatingInvoice.value = true;
  try {
    const res = await createManualInvoice(job.value.id);
    invoiceId.value = res.invoiceId;
    invoiceStatus.value = "draft";
    toast.success(
      res.created ? "Invoice started" : "Invoice already started",
      "Add your lines below, then send it when you're ready.",
    );
    await load();
  } catch (e) {
    toast.error("Couldn't start the invoice", humanizeError(e));
  } finally {
    creatingInvoice.value = false;
  }
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
    if (cancelNeedsApproval.value) {
      // Committed job — this only stages a request the tradesperson accepts.
      await requestJobChange(job.value.id, "cancel", reason);
      toast.success("Cancellation requested", "The tradesperson has to accept it.");
    } else {
      await cancelJob(job.value.id, reason);
      toast.success("Job cancelled", "The tradesperson has been notified.");
    }
    showCancelDialog.value = false;
    await load();
  } catch (e) {
    toast.error("Couldn't cancel", humanizeError(e));
  } finally {
    cancelling.value = false;
  }
}

function openPostponeDialog() {
  postponeReason.value = "";
  postponeResumeDate.value = null;
  showPostponeDialog.value = true;
}

async function confirmPostpone() {
  if (!job.value || postponing.value) return;
  const reason = postponeReason.value.trim();
  if (!reason) {
    toast.error("Please add a reason so the tradesperson knows why.");
    return;
  }
  postponing.value = true;
  try {
    await requestJobChange(job.value.id, "postpone", reason, postponeResumeDate.value);
    toast.success("Hold requested", "The tradesperson has to accept it.");
    showPostponeDialog.value = false;
    await load();
  } catch (e) {
    toast.error("Couldn't request hold", humanizeError(e));
  } finally {
    postponing.value = false;
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
      <!-- Status on the right of the top bar; the title gets full width below. -->
      <!-- Hidden for the tradesperson on `requested`, where this reads
           "Quote needed" — a demand for a step that is optional (#22). The
           Quote tab's badge dot carries that state now. Every other status
           keeps its readout; losing the status entirely would be a
           regression neither issue asked for. -->
      <Tag
        v-if="job && !(isTradie && job.status === 'requested')"
        :value="statusLabel(job.status, isClient ? 'client' : isTradie ? 'tradesperson' : null)"
        :severity="STATUS_SEVERITY[job.status]"
        class="shrink-0"
      />
    </div>

    <LoadingState v-if="loading" class="mt-4" />
    <div v-else-if="loadError" class="bs-empty mt-4">
      <i class="pi pi-exclamation-circle text-3xl mb-2 block text-[color:var(--bs-warning)]"></i>
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
        <!-- Counterparty at a glance. "Requested" alone left clients unsure who
             they'd picked; this names the other party (with avatar) right under
             the title so it's obvious on every tab, not just the Brief card. -->
        <div class="flex items-center gap-1.5 mt-1.5">
          <Avatar
            v-if="counterpartyPhotoUrl"
            :image="counterpartyPhotoUrl"
            shape="circle"
            size="normal"
            class="!w-5 !h-5"
          />
          <Avatar
            v-else
            :label="counterpartyInitials"
            shape="circle"
            size="normal"
            class="!w-5 !h-5 !text-[10px] !bg-[color:var(--bs-blue)] !text-white font-semibold"
          />
          <span class="text-xs text-[color:var(--bs-muted)]">
            {{ isClient ? "with" : "for" }}
            <span class="font-medium text-[color:var(--bs-text)]">{{ counterpartyName }}</span>
          </span>
        </div>

        <!-- "Where are we?" at a glance — five fixed milestones; the Tag still
             carries the exact status. Hidden on cancelled jobs. -->
        <JobStatusTimeline
          :status="job.status"
          :status-before-hold="job.statusBeforeHold ?? null"
          class="mt-3 max-w-md"
        />

        <!-- Quick clock for the tradie while the job is active. The full
             Work Order tab handles travel + change-order sessions. -->
        <div v-if="isTradie && job.status === 'in_progress'" class="mt-2">
          <!-- Uninsured-work gate: must sign the waiver before starting. The
               clock-in button routes to the waiver dialog when this shows. -->
          <div
            v-if="needsUninsuredWaiver"
            class="mb-2 rounded-md border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] px-3 py-2 text-xs text-[color:var(--bs-warning-text)]"
          >
            <i class="pi pi-shield mr-1"></i>
            You're not insured for this job. Sign a quick waiver to start —
            <RouterLink to="/account" class="underline font-medium">or get covered first</RouterLink
            >.
          </div>
          <!-- Running: stop + what's on the clock (kind · rate). -->
          <div v-if="clockRunningOn(job.id)" class="flex items-center gap-2 flex-wrap">
            <Button
              :label="`Stop · ${formatElapsed(clockElapsedMs)}`"
              icon="pi pi-stop-circle"
              severity="danger"
              size="small"
              class="font-mono tabular-nums"
              :loading="clockBtnBusy"
              @click="onHeaderClockOut"
            />
            <span v-if="runningKindLabel" class="text-xs text-[color:var(--bs-muted)]">
              {{ runningKindLabel
              }}<template v-if="runningRateText"> · {{ runningRateText }}</template>
            </span>
          </div>

          <!-- Not insured yet: the only action is to sign the waiver. -->
          <Button
            v-else-if="needsUninsuredWaiver"
            label="Sign waiver"
            icon="pi pi-pencil"
            severity="warn"
            size="small"
            :loading="clockBtnBusy"
            @click="showWaiverDialog = true"
          />

          <!-- Cleared to start. Labour-only → plain button; travel / approved
               change orders add a dropdown so the tradie picks what to clock.
               The rate is always shown alongside. -->
          <div v-else class="flex items-center gap-2 flex-wrap">
            <!-- Labour-only → clock in directly. More than one option → a menu
                 the tradie opens and picks from, so travel / change orders can't
                 be missed. -->
            <template v-if="clockChoices.length === 1">
              <Button
                label="Clock in"
                icon="pi pi-play"
                size="small"
                :loading="clockBtnBusy"
                @click="startClock(labourChoice)"
              />
              <span class="text-xs text-[color:var(--bs-muted)]">{{ labourRateText }}</span>
            </template>
            <template v-else>
              <Button
                size="small"
                :disabled="clockBtnBusy"
                aria-haspopup="true"
                aria-label="Clock in"
                @click="openClockMenu"
              >
                <i class="pi pi-play text-xs" aria-hidden="true"></i>
                <span class="mx-1.5">Clock in</span>
                <i class="pi pi-chevron-down text-xs" aria-hidden="true"></i>
              </Button>
              <Menu ref="clockMenu" :model="clockMenuItems" popup />
            </template>
          </div>
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
        class="bs-card p-4 mb-4 border-l-4 border-l-[color:var(--bs-warning)]"
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
            class="!bg-[color:var(--bs-warning-tint)] !text-[color:var(--bs-warning-text)] font-semibold"
          />
          <div class="flex-1 min-w-0">
            <div class="font-semibold">Leave {{ counterpartyName }} a review</div>
            <p class="text-sm text-[color:var(--bs-muted)] mt-1">
              Hidden until they review you back.<template
                v-if="reviewDaysLeft !== null && reviewDaysLeft > 0"
              >
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
              Your review is in. Once they submit theirs, both go live.<template
                v-if="reviewDaysLeft !== null && reviewDaysLeft > 0"
              >
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

      <!-- Bring-your-own-client: the invited client hasn't joined yet
           (clientId null) — show the tradesperson the invite state. A null
           clientInvite is a job created without a client email; the banner
           renders it as a solo job with an "Invite client" action. -->
      <InviteStatusBanner
        v-if="isTradie && job.clientId === null"
        :job-id="job.id"
        :invite="job.clientInvite ?? null"
        class="mb-4"
        @changed="load"
      />

      <!-- Cancel/postpone request loop: respond (tradie), withdraw (client),
           or resume a held job (either). Self-renders only when there's a
           pending request or the job is on hold. -->
      <JobChangeBanner
        :job="job"
        :is-client="isClient"
        :is-tradie="isTradie"
        class="mb-4"
        @decided="load"
      />

      <!-- Client nudge: change orders awaiting approval. Routes to the Work
           Order tab where the approve/decline actions live. -->
      <ProposedChangeOrderBanner
        v-if="isClient && proposedExtras.length > 0"
        :proposed="proposedExtras"
        class="mb-4"
        @review="onTabChange('workorder')"
      />

      <!-- Client nudge: the tradesperson wants a site visit before quoting.
           Agree/decline happens right in the banner (one tap, no signature). -->
      <ProposedSiteVisitBanner
        v-if="isClient && proposedSiteVisit"
        :job-id="job.id"
        :visit="proposedSiteVisit"
        class="mb-4"
      />

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
              The client is filling in the trade-specific brief. You can introduce yourself in chat
              in the meantime — they'll see your message.
            </p>
          </div>
        </div>
      </div>

      <ClientQuoteApprovalBanner
        v-if="isClient && job.status === 'quoted'"
        :job-id="job.id"
        :uninsured="!tradieInsuranceLive"
        :tradie-name="resolvedTradespersonName"
        class="mb-4"
        @decided="load"
      />

      <!-- Solo (bring-your-own-client) counterpart: no client on Blue Seal to
           accept the quote, so the tradesperson records the offline acceptance
           their client gave them. -->
      <RecordOfflineAcceptanceBanner
        v-if="isTradie && job.clientId === null && job.status === 'quoted'"
        :job-id="job.id"
        class="mb-4"
        @recorded="load"
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
        class="mb-4"
        @review="onTabChange('invoice')"
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
        class="bs-card p-4 mb-4 border-l-4 border-l-[color:var(--bs-info)]"
      >
        <div class="flex items-start gap-3">
          <i class="pi pi-calendar text-[color:var(--bs-info)] text-xl mt-0.5"></i>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-base">
              {{ isClient ? "You're booked in" : "Booked with the client" }}
            </div>
            <p class="text-sm mt-1">
              {{ formatScheduled(job.scheduledStart, job.scheduledEnd) }}
            </p>
            <p class="text-xs text-[color:var(--bs-muted)] mt-1">
              {{
                isClient
                  ? "The tradesperson will arrive at the agreed time. Use the chat below for any last-minute updates."
                  : "Reminder will fire 24 h ahead. Use the chat for any last-minute coordination."
              }}
            </p>
          </div>
        </div>
      </div>

      <JobTabBar :tabs="tabs" :model-value="activeTab" @update:model-value="onTabChange" />

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
          @save-brief="saveBrief"
          @return-to-applicants="onReturnToApplicants"
          @save-notes="saveNotes"
          @update-log="updateLogManually"
        />
        <ScheduleTab
          v-else-if="activeTab === 'schedule'"
          :job="job"
          :is-client="isClient"
          :is-tradie="isTradie"
          :sessions="sessions"
          :saving-session="savingSession"
          :can-instant-cancel="canInstantCancel"
          :can-request-cancel="canRequestCancel"
          :can-request-postpone="canRequestPostpone"
          @save-session="onSaveSession"
          @delete-session="onDeleteSession"
          @open-cancel-dialog="openCancelDialog"
          @open-postpone-dialog="openPostponeDialog"
        />
        <WorkOrderTab
          v-else-if="activeTab === 'workorder'"
          :job="job"
          :is-client="isClient"
          :is-tradie="isTradie"
          :extras="jobExtras"
          @create-invoice="showFinishSheet = true"
        />
        <QuoteTab
          v-else-if="activeTab === 'quote' && isTradie"
          :job-id="job.id"
          :status="job.status"
          :site-visit-agreed-note="siteVisitAgreedNote"
          @submitted="load"
          @go-tab="onTabChange"
        />
        <InvoiceTab
          v-else-if="activeTab === 'invoice'"
          :job="job"
          :is-client="isClient"
          :is-tradie="isTradie"
          :invoice-id="invoiceId"
          :invoice-status="invoiceStatus"
          :creating-invoice="creatingInvoice"
          :invoice-payable="invoicePayable"
          :marking-paid="markingPaid"
          :resolved-tradesperson-name="resolvedTradespersonName"
          :resolved-client-name="resolvedClientName"
          @mark-paid="onMarkPaid"
          @revise-quote="onTabChange('quote')"
          @create-invoice="showFinishSheet = true"
          @create-manual-invoice="onCreateManualInvoice"
          @decided="load"
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
      <JobChatOverlay v-model:visible="chatOverlayOpen" :job="job" :is-tradie="isTradie" />

      <!-- Trust escape hatch: a real route to raise an issue on a committed /
           paid job, routed to the support queue with job context (P2-15). -->
      <div v-if="canReportProblem" class="bs-container mt-8 mb-2 text-center">
        <button
          type="button"
          class="text-xs text-[color:var(--bs-muted)] underline inline-flex items-center gap-1"
          @click="showReportProblem = true"
        >
          <i class="pi pi-flag text-[10px]" aria-hidden="true"></i>
          Report a problem with this job
        </button>
      </div>
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
      style="left: var(--bs-content-left-offset, 0px)"
    >
      <div class="bs-container">
        <Button
          v-if="job.status === 'awaiting_upfront_payment'"
          :label="
            job.upfrontFee
              ? `Mark upfront received — ${money(job.upfrontFee.amountCents)}`
              : 'Mark upfront received'
          "
          icon="pi pi-check"
          severity="success"
          class="w-full"
          size="large"
          :loading="markingUpfront"
          @click="onMarkUpfrontPaid"
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
      :billing-type="jobBillingType(job)"
      :extras="jobExtras"
      :upfront-fee-paid-cents="job.upfrontFee?.paidAt ? job.upfrontFee.amountCents : 0"
      @submitted="load"
    />

    <UninsuredWaiverDialog
      v-if="job && isTradie"
      v-model:visible="showWaiverDialog"
      :busy="signingWaiver"
      @confirm="onSignWaiver"
    />

    <Dialog
      v-model:visible="showCollisionDialog"
      modal
      header="Schedule conflict"
      :style="{ width: '32rem', maxWidth: '92vw' }"
    >
      <p class="text-sm text-[color:var(--bs-text)] mb-3">
        The time you picked overlaps with
        {{ collisions.length }} existing {{ collisions.length === 1 ? "booking" : "bookings" }}:
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
                  : 'pi pi-ban text-[color:var(--bs-warning)] mt-0.5'
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
        You can still schedule on top — useful when a block-off was a soft hold you're happy to
        override. It also lets you double-book if that's actually what you mean.
      </p>
      <template #footer>
        <Button label="Pick a different time" text @click="showCollisionDialog = false" />
        <Button
          label="Schedule anyway"
          icon="pi pi-calendar-plus"
          severity="warn"
          @click="commitPendingSession"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="showCancelDialog"
      modal
      :header="cancelNeedsApproval ? 'Request cancellation?' : 'Cancel this job?'"
      :style="{ width: '28rem', maxWidth: '92vw' }"
    >
      <!-- Upfront fee warning. Refunds aren't tracked in the data model
           (deferred to v1.1, per design.md), so flag the manual settlement
           obligation before the user commits — they'd otherwise cancel
           thinking platform owes them the refund. -->
      <div
        v-if="job?.upfrontFee?.paidAt"
        class="rounded-md border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] px-3 py-2 text-xs text-[color:var(--bs-warning-text)] mb-3"
      >
        <i class="pi pi-exclamation-triangle text-[color:var(--bs-warning)] mr-1"></i>
        This job already has a
        <span class="font-semibold">{{ money(job.upfrontFee.amountCents) }}</span>
        upfront fee paid. Refunds are handled outside Blue Seal — coordinate that with the
        {{ isClient ? "tradesperson" : "client" }} before cancelling.
      </div>
      <p class="text-sm text-[color:var(--bs-text)] mb-3">
        <template v-if="cancelNeedsApproval">
          The tradesperson is committed to this job, so this sends them a request to accept. Tell
          them what changed — they'll see it in their inbox.
        </template>
        <template v-else>
          Tell the tradesperson what changed. They'll see this in their inbox.
        </template>
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
          :label="cancelNeedsApproval ? 'Send request' : 'Cancel job'"
          icon="pi pi-ban"
          severity="danger"
          :loading="cancelling"
          @click="confirmCancel"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="showPostponeDialog"
      modal
      header="Put this job on hold?"
      :style="{ width: '28rem', maxWidth: '92vw' }"
    >
      <p class="text-sm text-[color:var(--bs-text)] mb-3">
        This sends the tradesperson a request to pause the job. Once they accept, either of you can
        resume it any time.
      </p>
      <label class="block text-[11px] text-[color:var(--bs-muted)] mb-1">Reason</label>
      <Textarea
        v-model="postponeReason"
        rows="3"
        class="w-full"
        placeholder="e.g. waiting on a part, away for two weeks, sorting out access…"
        :maxlength="1000"
        autofocus
      />
      <label class="block text-[11px] text-[color:var(--bs-muted)] mt-3 mb-1">
        Proposed resume date (optional)
      </label>
      <DatePicker
        v-model="postponeResumeDate"
        class="w-full"
        date-format="D, M d, yy"
        placeholder="Pick a date"
        show-button-bar
        :min-date="new Date()"
      />
      <template #footer>
        <Button label="Never mind" text @click="showPostponeDialog = false" />
        <Button
          label="Send request"
          icon="pi pi-pause"
          severity="warn"
          :loading="postponing"
          @click="confirmPostpone"
        />
      </template>
    </Dialog>

    <ReportJobProblemDialog
      v-if="job"
      v-model:visible="showReportProblem"
      :job-id="job.id"
      :job-title="job.title"
    />
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
  justify-content: space-between;
  gap: 0.5rem;
  background: white;
  margin-inline: -1rem;
  padding-inline: 0.75rem;
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
