<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import Tag from "primevue/tag";
import Avatar from "primevue/avatar";
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
import VerifiedBadge from "@/components/VerifiedBadge.vue";
import JobCounterparty from "@/components/JobCounterparty.vue";
import LoadingState from "@/components/LoadingState.vue";
import QuoteComposer from "@/components/QuoteComposer.vue";
import type { QuoteComposerState } from "@/components/QuoteComposer.vue";
import QuoteBreakdown from "@/components/QuoteBreakdown.vue";

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
const submittingAccept = ref(false);
const submittingAcceptQuote = ref(false);
const submittingCancel = ref(false);
const submittingWithdraw = ref(false);

// Quote composer state for the apply form + the tradie's stored hourly rate
// (passed to the composer so hourly lines default to the profile rate).
const applyHourlyRate = ref<number | null>(null);
const composerState = ref<QuoteComposerState | null>(null);

// Which applicant's full quote is expanded in the client's list.
const expandedAppId = ref<string | null>(null);
function toggleExpanded(id: string) {
  expandedAppId.value = expandedAppId.value === id ? null : id;
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

async function submitApply() {
  if (!post.value || submittingApply.value) return;
  applyError.value = null;

  const s = composerState.value;
  if (!s || !s.valid || !s.payload) {
    applyError.value = s?.hasHourlyLineWithoutRate
      ? "An hourly line has no rate — set your profile rate, override it on the line, or switch it to Flat rate."
      : "Add at least one line item with an amount.";
    return;
  }

  const payload = {
    postId: postId.value,
    message: applyMessage.value.trim(),
    quote: s.payload,
    // proposedStartDate rides at the top level of the application (it's also
    // stored on the materialized quote server-side); the composer carries it
    // inside the payload, so lift it out here.
    proposedStartDate: s.payload.proposedStartDate,
  };
  const parsed = submitApplicationSchema.safeParse(payload);
  if (!parsed.success) {
    applyError.value = parsed.error.issues[0]?.message ?? "Check the form.";
    return;
  }

  submittingApply.value = true;
  try {
    await submitApplication(parsed.data);
    toast.success("Quote sent", "The client can compare and accept it. They typically respond within 24 hours.");
    applyMessage.value = "";
  } catch (e) {
    applyError.value = humanizeError(e);
  } finally {
    submittingApply.value = false;
  }
}

// Applicant display name — prefer the person/company name; fall back to a
// generic label. (Used in confirm copy + the card headline.)
function applicantName(app: WithId<ApplicationDoc>): string {
  const t = applicantTradies.value.get(app.tradespersonId);
  return t?.displayName?.trim() || t?.companyName?.trim() || "This tradesperson";
}

// Avatar source for an applicant — their profile photo, or null so the card
// renders an initial-circle instead.
function applicantPhoto(app: WithId<ApplicationDoc>): string | null {
  return applicantTradies.value.get(app.tradespersonId)?.photoURL ?? null;
}
function applicantInitial(app: WithId<ApplicationDoc>): string {
  const name = applicantName(app);
  return (name === "This tradesperson" ? "?" : name).slice(0, 1).toUpperCase();
}
// Company name shown as a secondary line — only when it adds information
// (i.e. it exists and isn't already what we're showing as the headline name).
function applicantCompany(app: WithId<ApplicationDoc>): string | null {
  const t = applicantTradies.value.get(app.tradespersonId);
  const company = t?.companyName?.trim();
  if (!company) return null;
  return company === applicantName(app) ? null : company;
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
    accept: async () => {
      submittingAcceptQuote.value = true;
      try {
        const { jobId } = await acceptApplicationQuote(postId.value, app.id);
        router.push({ name: "JobDetail", params: { id: jobId } });
      } catch (e) {
        toast.error("Couldn't accept this quote", humanizeError(e));
      } finally {
        submittingAcceptQuote.value = false;
      }
    },
  });
}

// Legacy path for applications that pre-date the quote-on-apply change
// (app.quote == null): pick the tradesperson, then they send a formal quote.
async function onAccept(app: WithId<ApplicationDoc>) {
  const tradieLabel = applicantName(app);
  confirm.require({
    message:
      `Start a job with ${tradieLabel}? Other applicants will be told you've chosen someone. ` +
      `If it doesn't work out, you can return to your applicants before completing the brief.`,
    header: "Pick this tradesperson?",
    icon: "pi pi-check-circle",
    acceptLabel: "Yes, pick them",
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
    message: "Cancel this post? Applicants will be told it's no longer open.",
    header: "Cancel post?",
    icon: "pi pi-trash",
    acceptLabel: "Yes, cancel",
    rejectLabel: "Keep open",
    accept: async () => {
      submittingCancel.value = true;
      try {
        await cancelJobPost(postId.value);
        toast.success("Post cancelled");
        post.value = await getJobPost(postId.value);
      } catch (e) {
        toast.error("Couldn't cancel post", humanizeError(e));
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
  withdrawn: "Withdrawn",
};

const applyStatusSeverity: Record<ApplicationDoc["status"], "info" | "success" | "warn" | "secondary"> = {
  pending: "info",
  selected: "success",
  rejected: "secondary",
  withdrawn: "warn",
};

const visibleApplications = computed(() =>
  applications.value.filter((a) => a.status !== "withdrawn"),
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
            label="Cancel post"
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
          <div
            v-for="app in visibleApplications"
            :key="app.id"
            class="bs-card p-4"
          >
            <div class="flex items-start justify-between gap-3 flex-wrap">
              <div class="flex items-start gap-3 min-w-0 flex-1">
                <!-- Profile photo (or initial) so the client recognises who
                     they're picking — name alone read as "Plumber" / a bare
                     trade label in testing. -->
                <Avatar
                  v-if="applicantPhoto(app)"
                  :image="applicantPhoto(app)!"
                  shape="circle"
                  size="large"
                  class="shrink-0"
                />
                <Avatar
                  v-else
                  :label="applicantInitial(app)"
                  shape="circle"
                  size="large"
                  class="shrink-0 !bg-[color:var(--bs-blue)] !text-white font-semibold"
                />
                <div class="min-w-0 flex-1">
                <a
                  :href="`/tradies/${app.tradespersonId}`"
                  target="_blank"
                  rel="noopener"
                  class="font-semibold text-[color:var(--bs-blue-dark)] hover:underline"
                >
                  {{
                    applicantTradies.get(app.tradespersonId)?.displayName
                      || applicantTradies.get(app.tradespersonId)?.companyName
                      || 'Tradesperson'
                  }}
                  <i class="pi pi-external-link text-xs"></i>
                </a>
                <div
                  v-if="applicantCompany(app)"
                  class="text-xs font-medium text-[color:var(--bs-text)] mt-0.5"
                >
                  {{ applicantCompany(app) }}
                </div>
                <div
                  v-if="applicantTradies.get(app.tradespersonId)"
                  class="text-xs text-[color:var(--bs-muted)] mt-0.5"
                >
                  {{ tradeLabel(applicantTradies.get(app.tradespersonId)!.trades[0]) }}
                </div>
                <div
                  v-if="applicantTradies.get(app.tradespersonId)"
                  class="text-xs text-[color:var(--bs-muted)] mt-0.5"
                >
                  Rating:
                  {{
                    applicantTradies.get(app.tradespersonId)!.ratingCount
                      ? applicantTradies.get(app.tradespersonId)!.ratingAvg.toFixed(1)
                      : '—'
                  }}
                  ({{ applicantTradies.get(app.tradespersonId)!.ratingCount }})
                </div>
                <!-- Verification badges mirror the public profile so the
                     client choosing between bidders sees the same trust
                     signals here. Only the badges that are actually
                     verified render; absence isn't called out (Blue Seal
                     vets every tradie before they're visible, so the
                     "missing" state is meaningful — they passed cert+ID
                     but haven't uploaded insurance/WSIB). -->
                <div
                  v-if="applicantTradies.get(app.tradespersonId)"
                  class="flex flex-wrap gap-1 mt-1.5"
                >
                  <VerifiedBadge
                    v-if="applicantTradies.get(app.tradespersonId)!.idVerified"
                    kind="id"
                    variant="pill"
                  />
                  <VerifiedBadge
                    v-if="(applicantTradies.get(app.tradespersonId)!.verifiedTrades?.length ?? 0) > 0"
                    kind="cert"
                    variant="pill"
                  />
                  <VerifiedBadge
                    v-if="applicantTradies.get(app.tradespersonId)!.insuranceVerified"
                    kind="insurance"
                    variant="pill"
                    :expires-at="applicantTradies.get(app.tradespersonId)!.insuranceExpiresAt"
                  />
                  <VerifiedBadge
                    v-if="applicantTradies.get(app.tradespersonId)!.wsibVerified"
                    kind="wsib"
                    variant="pill"
                    :expires-at="applicantTradies.get(app.tradespersonId)!.wsibExpiresAt"
                  />
                </div>
                </div>
              </div>
              <div class="text-right">
                <div class="font-semibold">{{ priceLabel(app.proposedPrice) }}</div>
                <div class="text-xs text-[color:var(--bs-muted)]">
                  Applied {{ relativeTime(app.createdAt) }}
                </div>
              </div>
            </div>
            <p class="text-sm mt-3 whitespace-pre-line">{{ app.message }}</p>
            <div v-if="app.proposedPrice.notes" class="text-xs text-[color:var(--bs-muted)] mt-2">
              Notes: {{ app.proposedPrice.notes }}
            </div>

            <!-- Full itemized quote (bid-marketplace). Collapsed by default;
                 the client expands to compare line items before accepting. -->
            <template v-if="app.quote">
              <button
                type="button"
                class="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--bs-blue)] hover:underline"
                :aria-expanded="expandedAppId === app.id"
                @click="toggleExpanded(app.id)"
              >
                <i :class="expandedAppId === app.id ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" class="text-xs"></i>
                {{ expandedAppId === app.id ? "Hide quote" : "View full quote" }}
              </button>
              <div
                v-if="expandedAppId === app.id"
                class="mt-2 rounded-lg border border-[color:var(--bs-border)] p-3"
              >
                <QuoteBreakdown :quote="app.quote" />
              </div>
            </template>

            <div v-if="post.status === 'open' && app.status === 'pending'" class="mt-3">
              <Button
                v-if="app.quote"
                label="Accept quote"
                icon="pi pi-check"
                severity="success"
                :loading="submittingAcceptQuote"
                @click="onAcceptQuote(app)"
              />
              <Button
                v-else
                label="Pick this tradesperson"
                icon="pi pi-check"
                :loading="submittingAccept"
                @click="onAccept(app)"
              />
            </div>
            <div v-else-if="app.status !== 'pending'" class="mt-3">
              <Tag :value="applyStatusLabel[app.status]" :severity="applyStatusSeverity[app.status]" />
            </div>
          </div>
        </div>
      </template>

      <!-- TRADIE VIEW -->
      <template v-else-if="isTradie && post.status === 'open'">
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
          <div v-else class="text-xs mt-2">Proposed: {{ priceLabel(myApplication.proposedPrice) }}</div>
          <div v-if="myApplication.status === 'pending'" class="mt-3">
            <Button
              label="Withdraw application"
              icon="pi pi-times"
              severity="secondary"
              outlined
              :loading="submittingWithdraw"
              @click="onWithdraw"
            />
          </div>
        </div>

        <form
          v-else
          class="bs-card p-5 mt-6 space-y-4"
          @submit.prevent="submitApply"
        >
          <h2 class="text-lg font-semibold">Send a quote</h2>
          <p class="text-xs text-[color:var(--bs-muted)]">
            Your quote is what the client compares and accepts — itemize the work
            so they can say yes with confidence.
          </p>
          <Message v-if="applyError" severity="error" :closable="false">
            {{ applyError }}
          </Message>
          <div>
            <label class="text-sm font-medium">Cover message</label>
            <Textarea
              v-model="applyMessage"
              rows="4"
              maxlength="2000"
              placeholder="Why you're a good fit, your approach, when you can start, and what's included…"
              class="mt-1 w-full"
            />
          </div>

          <QuoteComposer
            :hourly-rate-cents="applyHourlyRate"
            hide-note
            @update:state="(s) => (composerState = s)"
          />

          <Button
            type="submit"
            :label="
              composerState && composerState.totals.total > 0
                ? `Send quote — ${money(composerState.totals.total)}`
                : 'Send quote'
            "
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
  </section>
</template>
