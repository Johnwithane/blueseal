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
  scheduleJob,
  updateJobStatus,
  updatePrivateNotes,
  saveJobIntakeAndAdvance,
} from "@/firebase/services/jobs";
import { returnToApplicants } from "@/firebase/services/jobPosts";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { findCollisions, type Collision } from "@/firebase/services/bookings";
import { useConfirm } from "primevue/useconfirm";
import { getInvoiceByJobId } from "@/firebase/services/invoices";
import { useAuthStore } from "@/stores/auth";
import type { JobDoc, JobStatus, TradespersonDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import ChatThread from "@/components/ChatThread.vue";
import IntakeFormRenderer from "@/components/IntakeFormRenderer.vue";
import AiToolsPanel from "@/components/AiToolsPanel.vue";
import InvoiceEditor from "@/components/InvoiceEditor.vue";
import ReviewPrompt from "@/components/ReviewPrompt.vue";
import TimeTrackerCard from "@/components/TimeTrackerCard.vue";
import ExpensesCard from "@/components/ExpensesCard.vue";
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
const subscriptionOn = ref(false);
const loading = ref(true);
// When the URL points at a job the signed-in user can't read (notification
// pointing at a stale or wrong id, deep link from another account) the
// service throws permission-denied. Catch it here so the view shows a
// useful empty state instead of hanging on "Loading…" forever.
const loadError = ref<string | null>(null);

const scheduledStart = ref<Date | null>(null);
const scheduledEnd = ref<Date | null>(null);
const privateNotes = ref("");

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

const statusOptions: { label: string; value: JobStatus }[] = [
  { label: "Accepted", value: "accepted" },
  { label: "Requested", value: "requested" },
  { label: "Quoted", value: "quoted" },
  { label: "Scheduled", value: "scheduled" },
  { label: "In progress", value: "in_progress" },
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

    // Only the tradie needs subscription state (AI tools are tradie-only).
    // Clients have no reason to read the tradie's user doc.
    if (isTradie.value && auth.user) {
      subscriptionOn.value = auth.user.hasActiveSubscription;
    } else {
      subscriptionOn.value = false;
    }

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
    // current auth UID so when two tabs disagree (Firebase Auth state is
    // shared across tabs on the same origin — last-signed-in wins) the
    // mismatch is visible in the console.
    // eslint-disable-next-line no-console
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
  scheduled: "success",
  in_progress: "success",
  awaiting_payment: "warn",
  complete: "success",
  reviewed: "secondary",
  cancelled: "danger",
};
</script>

<template>
  <section class="bs-container py-6">
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
        <div>
          <h1 class="text-xl font-bold">{{ job.title }}</h1>
          <div class="text-xs text-[color:var(--bs-muted)]">
            {{ tradeLabel(job.trade) }} • Created {{ date(job.createdAt) }} •
            {{ job.address.line1 }}, {{ job.address.city }}
          </div>
        </div>
        <Tag :value="job.status" :severity="statusColor[job.status]" />
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
            <RouterLink
              v-if="job.sourcePostId"
              :to="{ name: 'JobPostDetail', params: { postId: job.sourcePostId } }"
              class="text-xs text-[color:var(--bs-muted)] underline mt-2 inline-block"
            >
              Changed your mind? You can return to your applicants until you complete the brief.
            </RouterLink>
            <Button
              v-if="job.sourcePostId"
              label="Return to applicants"
              icon="pi pi-undo"
              text
              size="small"
              class="ml-2"
              :loading="returningToApplicants"
              @click="onReturnToApplicants"
            />
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

      <div class="grid lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 space-y-4">
          <ChatThread :chat-id="job.chatId" />

          <div class="bs-card p-4">
            <h3 class="font-semibold text-sm mb-2">Original request</h3>
            <p class="text-sm whitespace-pre-wrap">{{ job.description }}</p>
            <div v-if="job.intakePhotos.length" class="grid grid-cols-4 gap-2 mt-3">
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

          <TimeTrackerCard
            v-if="isTradie || isClient"
            :job-id="job.id"
            :is-tradie="isTradie"
          />

          <ExpensesCard
            v-if="isTradie"
            :job-id="job.id"
            :client-id="job.clientId"
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

          <div v-if="isTradie" class="bs-card p-3">
            <h3 class="font-semibold text-sm mb-2">Status</h3>
            <Select
              :model-value="job.status"
              :options="statusOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              @update:model-value="(v) => setStatus(v as JobStatus)"
            />
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

          <div class="bs-card p-3">
            <h3 class="font-semibold text-sm mb-2">Schedule</h3>
            <div v-if="job.scheduledStart" class="text-sm">
              {{ dateTime(job.scheduledStart) }} → {{ dateTime(job.scheduledEnd) }}
            </div>
            <template v-if="isTradie">
              <DatePicker v-model="scheduledStart" show-time hour-format="24" class="w-full mt-2" placeholder="Start" />
              <DatePicker v-model="scheduledEnd" show-time hour-format="24" class="w-full mt-2" placeholder="End" />
              <Button
                label="Save schedule"
                icon="pi pi-calendar"
                class="mt-2 w-full"
                outlined
                :loading="savingSchedule"
                @click="saveSchedule"
              />
            </template>
          </div>

          <div v-if="isTradie" class="bs-card p-3">
            <h3 class="font-semibold text-sm mb-2">Private notes (tradesperson only)</h3>
            <Textarea v-model="privateNotes" rows="4" class="w-full" />
            <Button label="Save notes" icon="pi pi-save" outlined size="small" class="mt-2" @click="saveNotes" />
          </div>

          <AiToolsPanel v-if="isTradie" :job-id="job.id" :has-active-subscription="subscriptionOn" />

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
