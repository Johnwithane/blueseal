<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
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
  JobPostDoc,
  JobPostMetaDoc,
  TradespersonDoc,
  WithId,
} from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { submitApplicationSchema } from "@/validation/schemas";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables";
import { humanizeError } from "@/utils/errors";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const confirm = useConfirm();
const { relativeTime } = useFormatters();

const postId = computed(() => route.params.postId as string);
const post = ref<WithId<JobPostDoc> | null>(null);
const meta = ref<JobPostMetaDoc | null>(null);
const applications = ref<WithId<ApplicationDoc>[]>([]);
const applicantTradies = ref<Map<string, WithId<TradespersonDoc>>>(new Map());
const myApplication = ref<WithId<ApplicationDoc> | null>(null);
const photoUrls = ref<Map<string, string>>(new Map());

const loading = ref(true);
const error = ref<string | null>(null);

// Apply form (tradesperson view)
const applyMessage = ref("");
const applyType = ref<"fixed" | "hourly">("fixed");
const applyAmount = ref<number | null>(null);
const applyNotes = ref("");
const applyStartDate = ref<string>("");
const submittingApply = ref(false);
const submittingAccept = ref(false);
const submittingCancel = ref(false);
const submittingWithdraw = ref(false);

let unsubMeta: (() => void) | null = null;
let unsubApps: (() => void) | null = null;
let unsubMyApp: (() => void) | null = null;

const isClient = computed(
  () => post.value && auth.fbUser?.uid === post.value.clientId,
);
const isTradie = computed(() => auth.role === "tradesperson");

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
  error.value = null;

  const payload = {
    postId: postId.value,
    message: applyMessage.value.trim(),
    proposedPrice: {
      type: applyType.value,
      amount: Math.round((applyAmount.value ?? 0) * 100),
      ...(applyNotes.value.trim() ? { notes: applyNotes.value.trim() } : {}),
    },
    ...(applyStartDate.value ? { proposedStartDate: applyStartDate.value } : {}),
  };
  const parsed = submitApplicationSchema.safeParse(payload);
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? "Check the form.";
    return;
  }

  submittingApply.value = true;
  try {
    await submitApplication(parsed.data);
    toast.success("Application sent", "Clients typically respond within 24 hours.");
    applyMessage.value = "";
    applyAmount.value = null;
    applyNotes.value = "";
    applyStartDate.value = "";
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    submittingApply.value = false;
  }
}

async function onAccept(app: WithId<ApplicationDoc>) {
  const tradie = applicantTradies.value.get(app.tradespersonId);
  const tradieLabel = tradie ? tradeLabel(tradie.trades[0]) : "this tradesperson";
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
        error.value = humanizeError(e);
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
        error.value = humanizeError(e);
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
    error.value = humanizeError(e);
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
    <div v-if="loading" class="bs-card p-6 text-center text-[color:var(--bs-muted)]">
      <i class="pi pi-spin pi-spinner mr-2"></i>Loading post…
    </div>

    <Message v-else-if="error" severity="error" :closable="false">{{ error }}</Message>

    <template v-else-if="post">
      <!-- HEADER -->
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 class="text-2xl font-bold">{{ post.title }}</h1>
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
        <p class="text-sm whitespace-pre-line">{{ post.description }}</p>

        <div class="grid grid-cols-2 gap-3 text-sm">
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

        <div v-if="post.photos.length" class="grid grid-cols-4 gap-2">
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
              <div class="min-w-0 flex-1">
                <a
                  :href="`/tradies/${app.tradespersonId}`"
                  target="_blank"
                  rel="noopener"
                  class="font-semibold text-[color:var(--bs-blue-dark)] hover:underline"
                >
                  {{
                    applicantTradies.get(app.tradespersonId)
                      ? tradeLabel(applicantTradies.get(app.tradespersonId)!.trades[0])
                      : 'Tradesperson'
                  }}
                  <i class="pi pi-external-link text-xs"></i>
                </a>
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
            <div v-if="post.status === 'open' && app.status === 'pending'" class="mt-3">
              <Button
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
          <div class="text-xs mt-2">Proposed: {{ priceLabel(myApplication.proposedPrice) }}</div>
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
          <h2 class="text-lg font-semibold">Apply for this job</h2>
          <p class="text-xs text-[color:var(--bs-muted)]">
            Anticipate what the client might ask — your approach, availability, what's included.
          </p>
          <div>
            <label class="text-sm font-medium">Cover message</label>
            <Textarea
              v-model="applyMessage"
              rows="5"
              maxlength="2000"
              placeholder="Why you're a good fit, your approach, when you can start, and what's included…"
              class="mt-1 w-full"
            />
          </div>
          <div class="grid sm:grid-cols-3 gap-2">
            <div>
              <label class="text-sm font-medium">Quote type</label>
              <Select
                v-model="applyType"
                :options="[
                  { label: 'Fixed', value: 'fixed' },
                  { label: 'Hourly', value: 'hourly' },
                ]"
                option-label="label"
                option-value="value"
                class="mt-1 w-full"
              />
            </div>
            <div class="sm:col-span-2">
              <label class="text-sm font-medium">
                {{ applyType === 'fixed' ? 'Total price' : 'Hourly rate' }} (CAD)
              </label>
              <InputNumber
                v-model="applyAmount"
                mode="currency"
                currency="CAD"
                :min="5"
                :max="100000"
                :min-fraction-digits="0"
                :max-fraction-digits="0"
                class="mt-1 w-full"
              />
            </div>
          </div>
          <div>
            <label class="text-sm font-medium">Notes (optional)</label>
            <Textarea
              v-model="applyNotes"
              rows="2"
              maxlength="500"
              placeholder="What's included or excluded, materials, etc."
              class="mt-1 w-full"
            />
          </div>
          <Button
            type="submit"
            label="Send application"
            icon="pi pi-send"
            :loading="submittingApply"
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
