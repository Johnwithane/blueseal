<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import Tag from "primevue/tag";
import Message from "primevue/message";
import { useConfirm } from "primevue/useconfirm";
import { useAuthStore } from "@/stores/auth";
import {
  getJobPost,
  subscribeJobPostMeta,
  cancelJobPost,
} from "@/firebase/services/jobPosts";
import {
  acceptApplication,
  acceptApplicationQuote,
  declineApplication,
  subscribeApplicationsForPost,
  subscribeMyApplicationForPost,
  submitApplication,
  withdrawApplication,
} from "@/firebase/services/applications";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { ref as storageRef, getDownloadURL } from "firebase/storage";
import { storage } from "@/firebase/config";
import type {
  ApplicationDoc,
  IntakeField,
  JobPostDoc,
  JobPostMetaDoc,
  ReferralDoc,
  TradespersonDoc,
  WithId,
} from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { intakeFieldsForTrade } from "@/data/intakeSchemas";
import IntakeFormRenderer from "@/components/IntakeFormRenderer.vue";
import { submitApplicationSchema } from "@/validation/schemas";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables";
import { humanizeError } from "@/utils/errors";
import JobCounterparty from "@/components/JobCounterparty.vue";
import LoadingState from "@/components/LoadingState.vue";
import QuoteComposer from "@/components/QuoteComposer.vue";
import type { QuoteComposerInitial, QuoteComposerState } from "@/components/QuoteComposer.vue";
import { draftQuoteWithAi } from "@/firebase/services/aiDrafts";
import SiteVisitForm from "@/components/SiteVisitForm.vue";
import type { SiteVisitFormState } from "@/components/SiteVisitForm.vue";
import QuoteBreakdown from "@/components/QuoteBreakdown.vue";
import QuoteSignatureDialog from "@/components/QuoteSignatureDialog.vue";
import ApplicantCard from "@/components/jobPost/ApplicantCard.vue";
import ApplicationThread from "@/components/jobPost/ApplicationThread.vue";
import ApplicationThreadOverlay from "@/components/jobPost/ApplicationThreadOverlay.vue";
import DeclineApplicationDialog from "@/components/jobPost/DeclineApplicationDialog.vue";
import ReviseApplicationDialog from "@/components/jobPost/ReviseApplicationDialog.vue";
import ReferJobDialog from "@/components/jobPost/ReferJobDialog.vue";
import { listReferralsToMeForPost } from "@/firebase/services/referrals";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const confirm = useConfirm();
const { relativeTime, money } = useFormatters();

const postId = computed(() => route.params.postId as string);
const post = ref<WithId<JobPostDoc> | null>(null);
const meta = ref<JobPostMetaDoc | null>(null);
const applications = ref<WithId<ApplicationDoc>[]>([]);
const applicantTradies = ref<Map<string, WithId<TradespersonDoc>>>(new Map());
const myApplication = ref<WithId<ApplicationDoc> | null>(null);
const photoUrls = ref<Map<string, string>>(new Map());

const loading = ref(true);
// Page-load error only — anything that switches the page to the error view.
// Per-action failures must NOT write here, or they'll replace the whole
// post + form with a bare message (the "white screen with just the error"
// bug). Use applyError for the apply form, toast.error for other actions.
const error = ref<string | null>(null);

// Apply form (tradesperson view) — now a full itemized quote.
const applyMessage = ref("");
const submittingApply = ref(false);
const applyError = ref<string | null>(null);
// Set on the first failed submit so the composer surfaces every blocking
// issue inline (per-field highlights + summary list).
const applyAttempted = ref(false);
const submittingAccept = ref(false);
const submittingAcceptQuote = ref(false);
const submittingCancel = ref(false);
const submittingWithdraw = ref(false);

// Accepting a job-board quote requires the client to sign off first. The
// confirm dialog stashes the chosen applicant here and opens the signature
// pad; acceptApplicationQuote fires from onSignedAcceptQuote.
const showSignDialog = ref(false);
const pendingApp = ref<WithId<ApplicationDoc> | null>(null);

// Quote composer state for the apply form + the tradie's stored hourly rate
// (passed to the composer so hourly lines default to the profile rate).
const applyHourlyRate = ref<number | null>(null);
const composerState = ref<QuoteComposerState | null>(null);
// AI-drafted seed for the apply composer (set by Draft with AI below).
const applyInitial = ref<QuoteComposerInitial | null>(null);
const draftingApply = ref(false);
// "quote" = apply with a full itemized quote. "site_visit" = apply asking to
// see the job first, with an optional fee (no quote yet). "chat" = open a
// conversation first — no quote until the tradie has the answers they need.
const applyMode = ref<"quote" | "site_visit" | "chat">("quote");
const siteVisitState = ref<SiteVisitFormState | null>(null);
const applySubmitLabel = computed(() => {
  if (applyMode.value === "chat") return "Apply & start chat";
  if (applyMode.value === "site_visit") {
    const fee = siteVisitState.value?.fee.feeCents ?? 0;
    return fee > 0 ? `Apply — site visit ${money(fee)}` : "Apply — free site visit";
  }
  const total = composerState.value?.totals.total ?? 0;
  return total > 0 ? `Send quote — ${money(total)}` : "Send quote";
});

// Pre-acceptance Q&A + decline (client side). One overlay/dialog serves every
// applicant row, driven by the stashed application.
const threadApp = ref<WithId<ApplicationDoc> | null>(null);
const showThread = ref(false);
const declineApp = ref<WithId<ApplicationDoc> | null>(null);
const showDecline = ref(false);
const submittingDecline = ref(false);

// Revise (tradie side) — reopen the apply quote prefilled with the current bid.
const showRevise = ref(false);
const showMyThread = ref(false);

// Referrals (tradie side): "Refer this job" dialog + the banner shown when
// peers referred this post to the viewing tradesperson.
const showRefer = ref(false);
const referralsToMe = ref<WithId<ReferralDoc>[]>([]);
const referrerNames = computed(() =>
  referralsToMe.value.map((r) => r.fromDisplayName).join(", "),
);
const referralNote = computed(
  () => referralsToMe.value.find((r) => r.message)?.message ?? null,
);

function openThread(app: WithId<ApplicationDoc>) {
  threadApp.value = app;
  showThread.value = true;
}
function openDecline(app: WithId<ApplicationDoc>) {
  declineApp.value = app;
  showDecline.value = true;
}
async function onConfirmDecline(reason: string) {
  const app = declineApp.value;
  if (!app || submittingDecline.value) return;
  submittingDecline.value = true;
  try {
    await declineApplication(postId.value, app.id, reason);
    toast.success("Applicant declined", "They've been told why and can revise if it helps.");
    showDecline.value = false;
  } catch (e) {
    toast.error("Couldn't decline applicant", humanizeError(e));
  } finally {
    submittingDecline.value = false;
  }
}

let unsubMeta: (() => void) | null = null;
let unsubApps: (() => void) | null = null;
let unsubMyApp: (() => void) | null = null;

const isClient = computed(
  () => post.value && auth.fbUser?.uid === post.value.clientId,
);
const isTradie = computed(() => auth.activeRole === "tradesperson");

// Trade-specific questionnaire captured at post time, shown read-only to both
// the client and applying tradies so quotes are grounded in real detail.
const postIntakeFields = computed<IntakeField[]>(() =>
  post.value ? intakeFieldsForTrade(post.value.trade) : [],
);
const hasPostIntake = computed(
  () => Object.keys(post.value?.intakeFormData ?? {}).length > 0,
);

onMounted(async () => {
  if (!postId.value) return;
  try {
    post.value = await getJobPost(postId.value);
    if (!post.value) {
      error.value = "Job post not found or you don't have access.";
      return;
    }

    // Resolve photo download URLs.
    for (const path of post.value.photos) {
      try {
        const url = await getDownloadURL(storageRef(storage, path));
        photoUrls.value.set(path, url);
      } catch {
        /* missing — skip */
      }
    }

    if (isClient.value) {
      unsubMeta = subscribeJobPostMeta(postId.value, (m) => (meta.value = m));
      unsubApps = subscribeApplicationsForPost(postId.value, async (apps) => {
        applications.value = apps;
        // Lazy-load tradie docs for each applicant we haven't fetched yet.
        for (const a of apps) {
          if (!applicantTradies.value.has(a.tradespersonId)) {
            const t = await getTradesperson(a.tradespersonId);
            if (t) applicantTradies.value.set(a.tradespersonId, t);
          }
        }
        // Force reactivity for Map.
        applicantTradies.value = new Map(applicantTradies.value);
      });
    } else if (isTradie.value && auth.fbUser) {
      unsubMyApp = subscribeMyApplicationForPost(
        postId.value,
        auth.fbUser.uid,
        (a) => (myApplication.value = a),
      );
      // Seed the composer's hourly default from the tradie's profile rate.
      try {
        applyHourlyRate.value = (await getTradesperson(auth.fbUser.uid))?.hourlyRate ?? null;
      } catch {
        applyHourlyRate.value = null;
      }
      // "Referred to you by" banner. Own try/catch — a referral-read failure
      // must not write the page-level error ref (see comment above).
      try {
        referralsToMe.value = await listReferralsToMeForPost(auth.fbUser.uid, postId.value);
      } catch {
        referralsToMe.value = [];
      }
    }
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  unsubMeta?.();
  unsubApps?.();
  unsubMyApp?.();
});

const urgencyLabel = computed(() => {
  if (!post.value) return "";
  if (post.value.urgency === "urgent") return "Urgent";
  if (post.value.urgency === "this_week") return "This week";
  return "Flexible";
});

function formatBudget(min: number, max: number): string {
  const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
  return `${fmt(min)}–${fmt(max)}`;
}

function priceLabel(p: ApplicationDoc["proposedPrice"]): string {
  const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
  return p.type === "fixed" ? fmt(p.amount) : `${fmt(p.amount)}/hr`;
}

// AI draft for the apply quote: built from the post details + this tradie's
// application Q&A thread (when one exists). Replaces typed rows after a
// confirm; the cover message picks up the drafted note only if still empty.
// Free today; routed through the server-side entitlement seam (Blue Seal Pro).
function onDraftApply() {
  if (draftingApply.value) return;
  if ((composerState.value?.totals.subtotal ?? 0) > 0) {
    confirm.require({
      message: "Replace your current line items with an AI draft? What you've typed will be overwritten.",
      header: "Draft with AI",
      icon: "pi pi-sparkles",
      acceptLabel: "Replace",
      rejectLabel: "Cancel",
      accept: () => void runApplyDraft(),
    });
  } else {
    void runApplyDraft();
  }
}

async function runApplyDraft() {
  draftingApply.value = true;
  try {
    const draft = await draftQuoteWithAi({ postId: postId.value });
    applyInitial.value = {
      lineItems: draft.lineItems,
      terms: draft.terms,
      estimatedDuration: draft.estimatedDuration,
    };
    if (!applyMessage.value.trim() && draft.noteToClient) {
      applyMessage.value = draft.noteToClient;
    }
    toast.success("Draft ready", "Prices are AI estimates — review every line before sending.");
  } catch (e) {
    toast.error("Couldn't draft the quote", humanizeError(e));
  } finally {
    draftingApply.value = false;
  }
}

async function submitApply() {
  if (!post.value || submittingApply.value) return;
  applyError.value = null;

  // Build the payload per mode: a full quote, a "site visit first" ask, or a
  // "chat first" opener.
  let payload: unknown;
  if (applyMode.value === "chat") {
    if (!applyMessage.value.trim()) {
      applyError.value = "Write an opening message — it starts the chat with the client.";
      return;
    }
    payload = {
      kind: "chat",
      postId: postId.value,
      message: applyMessage.value.trim(),
    };
  } else if (applyMode.value === "site_visit") {
    const sv = siteVisitState.value;
    if (!sv || !sv.valid) {
      applyError.value = "Tell the client what the site visit is for.";
      return;
    }
    payload = {
      kind: "site_visit",
      postId: postId.value,
      message: applyMessage.value.trim(),
      siteVisitFee: sv.fee,
      proposedStartDate: sv.proposedDate,
    };
  } else {
    const s = composerState.value;
    if (!s || !s.valid || !s.payload) {
      applyAttempted.value = true;
      applyError.value = s?.issues[0] ?? "Add at least one line item with an amount.";
      return;
    }
    payload = {
      kind: "full",
      postId: postId.value,
      message: applyMessage.value.trim(),
      quote: s.payload,
      // proposedStartDate rides at the top level of the application (it's also
      // stored on the materialized quote server-side); the composer carries it
      // inside the payload, so lift it out here.
      proposedStartDate: s.payload.proposedStartDate,
    };
  }

  const parsed = submitApplicationSchema.safeParse(payload);
  if (!parsed.success) {
    applyError.value = parsed.error.issues[0]?.message ?? "Check the form.";
    return;
  }

  submittingApply.value = true;
  try {
    await submitApplication(parsed.data);
    toast.success(
      applyMode.value === "quote" ? "Quote sent" : "Application sent",
      applyMode.value === "chat"
        ? "Your message is in front of the client. Chat it through, then send your quote when you're ready."
        : applyMode.value === "site_visit"
          ? "You asked to visit first. If the client picks you, you'll arrange the visit, then quote."
          : "The client can compare and accept it. They typically respond within 24 hours.",
    );
    applyMessage.value = "";
    applyAttempted.value = false;
  } catch (e) {
    applyError.value = humanizeError(e);
  } finally {
    submittingApply.value = false;
  }
}

// Applicant display name — prefer the person/company name; fall back to a
// generic label. (Used in the accept/decline confirm copy.)
function applicantName(app: WithId<ApplicationDoc>): string {
  const t = applicantTradies.value.get(app.tradespersonId);
  return t?.displayName?.trim() || t?.companyName?.trim() || "This tradesperson";
}

// Bid-marketplace accept: the applicant attached a full quote → accept it
// directly, which starts the job already-active and rejects the others.
async function onAcceptQuote(app: WithId<ApplicationDoc>) {
  confirm.require({
    message:
      `Accept ${applicantName(app)}'s quote and start the job? ` +
      `The other applicants will be told you've chosen someone.`,
    header: "Accept this quote?",
    icon: "pi pi-check-circle",
    acceptLabel: "Yes, accept",
    rejectLabel: "Cancel",
    accept: () => {
      // Confirmed — now collect the signature before firing the callable.
      pendingApp.value = app;
      showSignDialog.value = true;
    },
  });
}

async function onSignedAcceptQuote(signatureDataUrl: string) {
  const app = pendingApp.value;
  if (!app || submittingAcceptQuote.value) return;
  submittingAcceptQuote.value = true;
  try {
    const { jobId } = await acceptApplicationQuote(postId.value, app.id, signatureDataUrl);
    showSignDialog.value = false;
    pendingApp.value = null;
    router.push({ name: "JobDetail", params: { id: jobId } });
  } catch (e) {
    toast.error("Couldn't accept this quote", humanizeError(e));
  } finally {
    submittingAcceptQuote.value = false;
  }
}

// Quote-less accept path: either a legacy application (predates quote-on-apply)
// or a "site visit first" application (app.quote == null, app.kind ==
// "site_visit"). Picking the tradesperson starts the job in "requested"; a
// site-visit pick also records the agreed visit fee to pre-fill their quote.
async function onAccept(app: WithId<ApplicationDoc>) {
  const tradieLabel = applicantName(app);
  const isVisit = app.kind === "site_visit";
  confirm.require({
    message: isVisit
      ? `Go with ${tradieLabel}? They'll do a site visit first, then send you a full quote. ` +
        `Other applicants will be told you've chosen someone.`
      : app.kind === "chat"
        ? `Go with ${tradieLabel}? They'll send you a full quote on the job — your conversation ` +
          `carries over. Other applicants will be told you've chosen someone.`
        : `Start a job with ${tradieLabel}? Other applicants will be told you've chosen someone. ` +
          `If it doesn't work out, you can return to your applicants before completing the brief.`,
    header: isVisit ? "Agree to a site visit?" : "Pick this tradesperson?",
    icon: "pi pi-check-circle",
    acceptLabel: isVisit ? "Yes, agree" : "Yes, pick them",
    rejectLabel: "Cancel",
    accept: async () => {
      submittingAccept.value = true;
      try {
        const { jobId } = await acceptApplication(postId.value, app.id);
        router.push({ name: "JobDetail", params: { id: jobId } });
      } catch (e) {
        toast.error("Couldn't pick this tradesperson", humanizeError(e));
      } finally {
        submittingAccept.value = false;
      }
    },
  });
}

async function onCancelPost() {
  confirm.require({
    message: "Cancel this job? Applicants will be told it's no longer open.",
    header: "Cancel job?",
    icon: "pi pi-trash",
    acceptLabel: "Yes, cancel",
    rejectLabel: "Keep open",
    accept: async () => {
      submittingCancel.value = true;
      try {
        await cancelJobPost(postId.value);
        toast.success("Job cancelled");
        post.value = await getJobPost(postId.value);
      } catch (e) {
        toast.error("Couldn't cancel job", humanizeError(e));
      } finally {
        submittingCancel.value = false;
      }
    },
  });
}

async function onWithdraw() {
  submittingWithdraw.value = true;
  try {
    await withdrawApplication(postId.value);
    toast.success("Application withdrawn");
  } catch (e) {
    toast.error("Couldn't withdraw application", humanizeError(e));
  } finally {
    submittingWithdraw.value = false;
  }
}

const applyStatusLabel: Record<ApplicationDoc["status"], string> = {
  pending: "Pending",
  selected: "Selected",
  rejected: "Not chosen",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

const applyStatusSeverity: Record<ApplicationDoc["status"], "info" | "success" | "warn" | "secondary"> = {
  pending: "info",
  selected: "success",
  rejected: "secondary",
  declined: "secondary",
  withdrawn: "warn",
};

// Unread messages waiting for the tradesperson on their own application.
const myUnread = computed(() => {
  const uid = auth.fbUser?.uid;
  return uid ? (myApplication.value?.threadUnreadCounts?.[uid] ?? 0) : 0;
});

// The client's active list: hide withdrawn (tradie left), rejected (auto-set
// when another applicant was accepted), and declined (the client dismissed
// them — the card "goes away"). A declined applicant who revises flips back to
// pending and reappears.
const visibleApplications = computed(() =>
  applications.value.filter(
    (a) => a.status !== "withdrawn" && a.status !== "rejected" && a.status !== "declined",
  ),
);
</script>

<template>
  <section class="bs-container py-6 max-w-3xl">
    <LoadingState v-if="loading" label="Loading post…" />

    <Message v-else-if="error" severity="error" :closable="false">{{ error }}</Message>

    <template v-else-if="post">
      <!-- HEADER -->
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <h1 class="text-2xl font-bold break-words">{{ post.title }}</h1>
          <div class="text-xs text-[color:var(--bs-muted)] mt-1">
            {{ tradeLabel(post.trade) }} • {{ relativeTime(post.createdAt) }}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Tag :value="post.status" :severity="post.status === 'open' ? 'info' : 'secondary'" />
          <Tag :value="urgencyLabel" severity="warn" />
        </div>
      </div>

      <!-- A peer sent this post to the viewing tradesperson. -->
      <Message
        v-if="referralsToMe.length"
        severity="info"
        :closable="false"
        class="mt-4"
      >
        <strong>Referred to you by {{ referrerNames }}.</strong>
        <template v-if="referralNote"> "{{ referralNote }}"</template>
      </Message>

      <!-- POST BODY -->
      <article class="bs-card p-5 mt-4 space-y-4">
        <!-- Client identity (hidden from the post owner — they already
             know who they are). Browsing tradies see first-name + photo
             so they know who they'd be working for before applying. -->
        <div v-if="!isClient" class="pb-3 border-b border-[color:var(--bs-border)]">
          <div class="text-xs text-[color:var(--bs-muted)] mb-1.5">Posted by</div>
          <JobCounterparty
            role="client"
            :name="post.clientName"
            :photo-url="post.clientPhotoURL"
          />
        </div>

        <p class="text-sm whitespace-pre-line">{{ post.description }}</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <div class="text-xs text-[color:var(--bs-muted)]">Budget</div>
            <div class="font-medium">{{ formatBudget(post.budget.min, post.budget.max) }} CAD</div>
          </div>
          <div>
            <div class="text-xs text-[color:var(--bs-muted)]">Location</div>
            <div class="font-medium">
              {{ post.addressPublic.city }}, {{ post.addressPublic.region }}
              <span class="text-xs text-[color:var(--bs-muted)]">({{ post.addressPublic.postalFsa }})</span>
            </div>
            <div v-if="!isClient" class="text-xs text-[color:var(--bs-muted)] mt-0.5">
              Exact address shared after selection.
            </div>
          </div>
        </div>

        <!-- Trade-specific details the client answered when posting. Read-only
             for everyone; gives applicants the specifics they need to quote. -->
        <div
          v-if="postIntakeFields.length && hasPostIntake"
          class="border-t border-[color:var(--bs-border)] pt-4"
        >
          <div class="text-xs text-[color:var(--bs-muted)] mb-3">
            {{ tradeLabel(post.trade) }} details
          </div>
          <IntakeFormRenderer
            :model-value="post.intakeFormData ?? {}"
            :fields="postIntakeFields"
            readonly
            @update:model-value="() => {}"
          />
        </div>

        <div v-if="post.photos.length" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <div
            v-for="path in post.photos"
            :key="path"
            class="aspect-square rounded-md overflow-hidden bg-[color:var(--bs-bg)] border border-[color:var(--bs-border)]"
          >
            <img
              v-if="photoUrls.get(path)"
              :src="photoUrls.get(path)"
              alt=""
              class="h-full w-full object-cover"
            />
          </div>
        </div>
      </article>

      <!-- CLIENT VIEW -->
      <template v-if="isClient">
        <div v-if="post.status === 'open'" class="mt-4 flex flex-wrap gap-2">
          <Button
            label="Cancel job"
            icon="pi pi-times"
            severity="secondary"
            outlined
            :loading="submittingCancel"
            @click="onCancelPost"
          />
        </div>

        <div v-if="post.status === 'closed'" class="mt-4">
          <Message severity="success" :closable="false">
            You picked a tradesperson for this post — continue the job on the
            <RouterLink
              v-if="post.convertedJobId"
              :to="{ name: 'JobDetail', params: { id: post.convertedJobId } }"
              class="underline"
            >
              job page
            </RouterLink>.
          </Message>
        </div>

        <h2 class="text-lg font-semibold mt-6 flex items-center gap-2">
          Applicants
          <Tag v-if="meta" :value="meta.applicationCount" severity="secondary" />
        </h2>
        <p v-if="visibleApplications.length === 0" class="text-sm text-[color:var(--bs-muted)] mt-1">
          No applicants yet. Verified tradespeople in your area are being notified.
        </p>

        <div v-else class="space-y-3 mt-3">
          <ApplicantCard
            v-for="app in visibleApplications"
            :key="app.id"
            :app="app"
            :tradie="applicantTradies.get(app.tradespersonId) ?? null"
            :post-open="post.status === 'open'"
            :accepting="submittingAcceptQuote"
            :client-uid="auth.fbUser?.uid ?? null"
            @accept-quote="onAcceptQuote"
            @pick="onAccept"
            @decline="openDecline"
            @message="openThread"
          />
        </div>
      </template>

      <!-- TRADIE VIEW -->
      <template v-else-if="isTradie && post.status === 'open'">
        <!-- Know someone better suited? Available whether or not you've applied. -->
        <div class="mt-4 flex justify-end">
          <Button
            label="Refer this job"
            icon="pi pi-share-alt"
            outlined
            size="small"
            severity="secondary"
            @click="showRefer = true"
          />
        </div>

        <div v-if="myApplication" class="bs-card p-5 mt-6">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h2 class="text-lg font-semibold">Your application</h2>
              <div class="text-xs text-[color:var(--bs-muted)]">
                Applied {{ relativeTime(myApplication.createdAt) }}
              </div>
            </div>
            <Tag
              :value="applyStatusLabel[myApplication.status]"
              :severity="applyStatusSeverity[myApplication.status]"
            />
          </div>
          <p class="text-sm mt-3 whitespace-pre-line">{{ myApplication.message }}</p>
          <div
            v-if="myApplication.quote"
            class="mt-3 rounded-lg border border-[color:var(--bs-border)] p-3"
          >
            <QuoteBreakdown :quote="myApplication.quote" />
          </div>
          <div v-else-if="myApplication.kind === 'site_visit'" class="text-xs mt-2">
            <i class="pi pi-map-marker mr-1"></i>Site visit first —
            {{
              (myApplication.siteVisitFee?.feeCents ?? 0) > 0
                ? money(myApplication.siteVisitFee!.feeCents)
                : "free"
            }}. You'll send a full quote after the visit.
          </div>
          <div v-else-if="myApplication.kind === 'chat'" class="text-xs mt-2">
            <i class="pi pi-comments mr-1"></i>You asked to chat first — no quote yet.
            Talk it through in Messages, then hit <span class="font-medium">Send quote</span>
            when you're ready.
          </div>
          <div v-else class="text-xs mt-2">Proposed: {{ priceLabel(myApplication.proposedPrice) }}</div>

          <!-- Client passed with a reason — surfaced so the tradie knows what
               to change. Revising puts the quote back in front of the client. -->
          <div
            v-if="myApplication.status === 'declined' && myApplication.declinedReason"
            class="mt-3 rounded-lg border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] p-3"
          >
            <div class="flex items-start gap-2">
              <i class="pi pi-info-circle text-[color:var(--bs-warning)] mt-0.5"></i>
              <div class="min-w-0 flex-1">
                <div class="font-semibold text-sm text-[color:var(--bs-warning-text)]">The client passed on this quote</div>
                <p class="text-sm text-[color:var(--bs-warning-text)] mt-1 whitespace-pre-wrap">{{ myApplication.declinedReason }}</p>
                <p class="text-xs text-[color:var(--bs-warning-text)] mt-1">Revise your quote to put it back in front of them.</p>
              </div>
            </div>
          </div>

          <div
            v-if="myApplication.status === 'pending' || myApplication.status === 'declined'"
            class="mt-3 flex flex-wrap items-center gap-2"
          >
            <Button
              v-if="myApplication.status === 'pending'"
              :label="showMyThread ? 'Hide messages' : 'Messages'"
              icon="pi pi-comments"
              outlined
              size="small"
              @click="showMyThread = !showMyThread"
            />
            <Tag v-if="myUnread > 0 && !showMyThread" value="New" severity="danger" />
            <Button
              :label="myApplication.quote ? 'Revise quote' : 'Send quote'"
              :icon="myApplication.quote ? 'pi pi-pencil' : 'pi pi-send'"
              size="small"
              @click="showRevise = true"
            />
            <span class="flex-1"></span>
            <Button
              v-if="myApplication.status === 'pending'"
              label="Withdraw"
              icon="pi pi-times"
              severity="secondary"
              outlined
              size="small"
              :loading="submittingWithdraw"
              @click="onWithdraw"
            />
          </div>

          <!-- Inline Q&A thread with the client (pending only — once declined,
               messaging pauses until the tradie revises back into the list). -->
          <div
            v-if="myApplication.status === 'pending' && showMyThread"
            class="mt-3 rounded-lg border border-[color:var(--bs-border)] overflow-hidden bs-myapp-thread"
          >
            <ApplicationThread
              :post-id="postId"
              :application-id="myApplication.tradespersonId"
              role="tradesperson"
            />
          </div>
        </div>

        <form
          v-else
          class="bs-card p-5 mt-6 space-y-4"
          @submit.prevent="submitApply"
        >
          <h2 class="text-lg font-semibold">
            {{
              applyMode === "site_visit"
                ? "Apply with a site visit"
                : applyMode === "chat"
                  ? "Chat before quoting"
                  : "Send a quote"
            }}
          </h2>
          <p class="text-xs text-[color:var(--bs-muted)]">
            {{
              applyMode === "site_visit"
                ? "Some jobs can't be priced sight-unseen. Ask to see it first — if the client picks you, you'll arrange the visit, then send a full quote."
                : applyMode === "chat"
                  ? "Need more detail before pricing? Start a conversation with the client — once you have the answers, send your quote from this page."
                  : "Your quote is what the client compares and accepts — itemize the work so they can say yes with confidence."
            }}
          </p>

          <!-- Mode toggle: full quote / site visit first / chat first. -->
          <div class="flex rounded-lg border border-[color:var(--bs-border)] p-1 text-sm">
            <button
              type="button"
              class="flex-1 rounded-md py-2 px-2 font-medium transition-colors"
              :class="applyMode === 'quote' ? 'bg-[color:var(--bs-brand)] text-white' : 'text-[color:var(--bs-muted)]'"
              @click="applyMode = 'quote'"
            >
              Send a quote
            </button>
            <button
              type="button"
              class="flex-1 rounded-md py-2 px-2 font-medium transition-colors"
              :class="applyMode === 'site_visit' ? 'bg-[color:var(--bs-brand)] text-white' : 'text-[color:var(--bs-muted)]'"
              @click="applyMode = 'site_visit'"
            >
              Site visit first
            </button>
            <button
              type="button"
              class="flex-1 rounded-md py-2 px-2 font-medium transition-colors"
              :class="applyMode === 'chat' ? 'bg-[color:var(--bs-brand)] text-white' : 'text-[color:var(--bs-muted)]'"
              @click="applyMode = 'chat'"
            >
              Chat first
            </button>
          </div>

          <div>
            <label class="text-sm font-medium">
              <template v-if="applyMode === 'chat'">Your message</template>
              <template v-else>
                Cover message
                <span class="font-normal text-[color:var(--bs-muted)]">(optional)</span>
              </template>
            </label>
            <Textarea
              v-model="applyMessage"
              rows="4"
              maxlength="2000"
              :placeholder="
                applyMode === 'chat'
                  ? 'Introduce yourself and ask what you need to know to price this job…'
                  : 'Why you\'re a good fit, your approach, when you can start, and what\'s included…'
              "
              class="mt-1 w-full"
            />
            <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
              <template v-if="applyMode === 'chat'">
                This opens the conversation — the client replies right on their post.
              </template>
              <template v-else>
                Tip: a couple of sentences about your fit and approach improves your chances.
              </template>
            </p>
          </div>

          <!-- AI draft: post details + your Q&A thread → a starting quote. -->
          <div v-if="applyMode === 'quote'" class="flex items-center gap-2">
            <Button
              label="Draft with AI"
              icon="pi pi-sparkles"
              outlined
              size="small"
              :loading="draftingApply"
              :disabled="draftingApply"
              @click="onDraftApply"
            />
            <span class="text-[11px] leading-snug text-[color:var(--bs-muted)]">
              Builds a starting quote from the post and your messages — review every line.
            </span>
          </div>

          <SiteVisitForm
            v-if="applyMode === 'site_visit'"
            @update:state="(s) => (siteVisitState = s)"
          />
          <QuoteComposer
            v-else-if="applyMode === 'quote'"
            :hourly-rate-cents="applyHourlyRate"
            hide-note
            :initial="applyInitial"
            :show-errors="applyAttempted"
            @update:state="(s) => (composerState = s)"
          />

          <Message v-if="applyError" severity="error" :closable="false">
            {{ applyError }}
          </Message>
          <Button
            type="submit"
            :label="applySubmitLabel"
            icon="pi pi-send"
            :loading="submittingApply"
            :disabled="submittingApply"
            size="large"
          />
        </form>
      </template>

      <Message
        v-else-if="isTradie && post.status !== 'open'"
        severity="info"
        :closable="false"
        class="mt-6"
      >
        This job is no longer open for applications.
      </Message>
    </template>

    <!-- Sign-off for accepting a job-board applicant's quote. Driven by
         pendingApp so a single dialog serves every applicant row. -->
    <QuoteSignatureDialog
      v-model:visible="showSignDialog"
      :quote-total="pendingApp?.quote?.total"
      :upfront-fee-cents="pendingApp?.quote?.upfrontFee?.amountCents"
      :busy="submittingAcceptQuote"
      @confirm="onSignedAcceptQuote"
    />

    <!-- Client: per-applicant Q&A overlay + decline-with-reason dialog. -->
    <ApplicationThreadOverlay
      v-model:visible="showThread"
      :post-id="postId"
      :application-id="threadApp?.id ?? null"
      :counterparty-name="threadApp ? applicantName(threadApp) : ''"
      role="client"
    />
    <DeclineApplicationDialog
      v-model:visible="showDecline"
      :applicant-name="declineApp ? applicantName(declineApp) : 'this applicant'"
      :busy="submittingDecline"
      @confirm="onConfirmDecline"
    />

    <!-- Tradesperson: revise the quote on their own application. -->
    <ReviseApplicationDialog
      v-if="myApplication"
      v-model:visible="showRevise"
      :post-id="postId"
      :application="myApplication"
    />

    <!-- Tradesperson: send this post to a matching-trade peer. -->
    <ReferJobDialog v-if="post" v-model:visible="showRefer" :post="post" />
  </section>
</template>

<style scoped>
.bs-myapp-thread {
  height: 24rem;
}
</style>
