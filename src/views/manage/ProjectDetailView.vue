<script setup lang="ts">
// PM read-only project visibility (P3b-3). The owning project manager sees, per
// job in the project: the scoped posting's status, the incoming quotes WITH amounts
// (to broker the client's compare-and-choose), and once a contractor is picked, the
// won job's status + schedule. Strictly read-only: no chat, and the live invoice
// stays firewalled (rules expose only the job doc, never chats/ or invoices/).
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Tag from "primevue/tag";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import { useFormatters } from "@/composables";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import {
  subscribeProject,
  redispatchProject,
  cancelProject,
  resendProjectInvite,
} from "@/firebase/services/projects";
import { subscribeProjectPostingsForPm } from "@/firebase/services/jobPosts";
import { subscribeProjectJobsForPm } from "@/firebase/services/jobs";
import { subscribeApplicationsForPost } from "@/firebase/services/applications";
import { tradeLabel } from "@/data/trades";
import { statusLabel } from "@/utils/jobStatus";
import NewProjectForm from "@/components/manage/NewProjectForm.vue";
import AddProjectJobsForm from "@/components/manage/AddProjectJobsForm.vue";
import type {
  ApplicationDoc,
  JobDoc,
  JobPostDoc,
  ProjectDoc,
  WithId,
} from "@/firebase/interfaces";

const route = useRoute();
const auth = useAuthStore();
const toast = useToast();
const { money, date } = useFormatters();
useSeo({ title: "Project", noindex: true });

const projectId = String(route.params.projectId ?? "");
const project = ref<WithId<ProjectDoc> | null>(null);
const loaded = ref(false);
const loadError = ref<string | null>(null);
const busy = ref(false);
const postings = ref<WithId<JobPostDoc>[]>([]);
const jobs = ref<WithId<JobDoc>[]>([]);
const quotesByPost = ref<Record<string, WithId<ApplicationDoc>[]>>({});

let unsubProject: (() => void) | null = null;
let unsubPostings: (() => void) | null = null;
let unsubJobs: (() => void) | null = null;
const appUnsubs = new Map<string, () => void>();

// All the PM's postings/jobs come back across every project; narrow to this one.
const myPostings = computed(() =>
  postings.value.filter((p) => p.projectId === projectId),
);
const jobBySourcePost = computed(() => {
  const m = new Map<string, WithId<JobDoc>>();
  for (const j of jobs.value) if (j.sourcePostId) m.set(j.sourcePostId, j);
  return m;
});

function syncQuoteSubs(current: WithId<JobPostDoc>[]): void {
  const ids = new Set(current.map((p) => p.id));
  for (const [id, u] of appUnsubs) {
    if (!ids.has(id)) {
      u();
      appUnsubs.delete(id);
      const next = { ...quotesByPost.value };
      delete next[id];
      quotesByPost.value = next;
    }
  }
  for (const p of current) {
    if (!appUnsubs.has(p.id)) {
      appUnsubs.set(
        p.id,
        subscribeApplicationsForPost(p.id, (apps) => {
          quotesByPost.value = { ...quotesByPost.value, [p.id]: apps };
        }),
      );
    }
  }
}

function start() {
  const uid = auth.fbUser?.uid;
  if (!projectId || !uid) return;
  loadError.value = null;
  // A failed subscription must clear the spinner and offer a retry rather than
  // hang on "Loading…" forever (P2-06). The project sub is the view's gate.
  const onErr = (e: Error) => {
    loadError.value = humanizeError(e);
    loaded.value = true;
  };
  unsubProject?.();
  unsubPostings?.();
  unsubJobs?.();
  unsubProject = subscribeProject(
    projectId,
    (p) => {
      project.value = p;
      loaded.value = true;
    },
    onErr,
  );
  unsubPostings = subscribeProjectPostingsForPm(uid, (p) => (postings.value = p), onErr);
  unsubJobs = subscribeProjectJobsForPm(uid, (j) => (jobs.value = j), onErr);
}
onMounted(start);
watch(myPostings, (p) => syncQuoteSubs(p));
onUnmounted(() => {
  unsubProject?.();
  unsubPostings?.();
  unsubJobs?.();
  appUnsubs.forEach((u) => u());
  appUnsubs.clear();
});

const postingStatusLabel: Record<string, string> = {
  invited: "Sent to your trades",
  open: "Open to all trades",
  closed: "Filled",
  cancelled: "Cancelled",
  expired: "Expired",
};
const postingStatusSeverity: Record<string, "info" | "success" | "warn" | "secondary"> = {
  invited: "info",
  open: "warn",
  closed: "success",
  cancelled: "secondary",
  expired: "secondary",
};

// Accepted but no postings were ever created (dispatch failed) — recoverable.
const dispatchFailed = computed(
  () => project.value?.status === "accepted" && !(project.value.jobPostIds?.length),
);
// Pending = the PM can still manage the invite (resend / fix email / cancel).
const isPending = computed(
  () => project.value?.status === "invited" || project.value?.status === "claimed",
);

const showEmailForm = ref(false);
const newEmail = ref("");
const confirmingCancel = ref(false);
const newInviteLink = ref<string | null>(null);
const editing = ref(false);
const addingJobs = ref(false);

// Jobs the PM added after the client accepted, awaiting the client's per-job
// approve/decline (proposeProjectJobs). They have no posting yet, so they render
// from the project's jobSpecs rather than from myPostings.
const pendingSpecs = computed(() =>
  (project.value?.jobSpecs ?? []).filter((s) => s.status === "pendingClient"),
);
const declinedSpecs = computed(() =>
  (project.value?.jobSpecs ?? []).filter((s) => s.status === "declined"),
);
// Headline count excludes declined adds (they were never real work).
const liveJobCount = computed(
  () => (project.value?.jobSpecs ?? []).filter((s) => s.status !== "declined").length,
);
// The PM can only add jobs once the client has accepted; before that they edit the
// bundle (Edit project → updateProject).
const canAddJobs = computed(() => project.value?.status === "accepted");

async function retryDispatch(): Promise<void> {
  busy.value = true;
  try {
    await redispatchProject(projectId);
    toast.success("Sent", "The jobs are out to your trades for quotes.");
  } catch (e) {
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    busy.value = false;
  }
}

async function resendInvite(email?: string): Promise<void> {
  busy.value = true;
  try {
    const res = await resendProjectInvite(projectId, email);
    if (res.inviteLink) newInviteLink.value = res.inviteLink;
    showEmailForm.value = false;
    newEmail.value = "";
    toast.success(
      "Invite resent",
      res.emailed
        ? "We emailed your client again — or copy the link below to send it directly."
        : "Copy the link below to share it with your client directly.",
    );
  } catch (e) {
    toast.error("Couldn't resend", humanizeError(e));
  } finally {
    busy.value = false;
  }
}

async function doCancel(): Promise<void> {
  busy.value = true;
  try {
    await cancelProject(projectId);
    confirmingCancel.value = false;
    toast.success("Project cancelled", "It's been removed from your active list.");
  } catch (e) {
    toast.error("Couldn't cancel", humanizeError(e));
  } finally {
    busy.value = false;
  }
}

async function copyLink(link: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Copied", "Invite link copied.");
  } catch {
    toast.warn("Copy failed", "Copy the link manually.");
  }
}

function quoteAmount(a: WithId<ApplicationDoc>): number {
  return a.quote?.total ?? a.proposedPrice?.amount ?? 0;
}
// Live quotes worth showing the PM (drop withdrawn/rejected/declined).
function liveQuotes(postId: string): WithId<ApplicationDoc>[] {
  return (quotesByPost.value[postId] ?? []).filter(
    (a) => a.status !== "withdrawn" && a.status !== "rejected" && a.status !== "declined",
  );
}
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <RouterLink to="/manage" class="text-sm text-[color:var(--bs-blue)] no-underline">
      <i class="pi pi-arrow-left text-xs"></i> Back to cockpit
    </RouterLink>

    <div v-if="!loaded" class="text-sm text-[color:var(--bs-muted)] py-8 text-center">Loading…</div>

    <div v-else-if="loadError" class="bs-card p-6 text-center mt-6">
      <i class="pi pi-exclamation-triangle text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">Couldn't load this project</p>
      <p class="text-sm text-[color:var(--bs-muted)]">{{ loadError }}</p>
      <Button label="Try again" icon="pi pi-refresh" size="small" class="mt-3" @click="start" />
    </div>

    <div v-else-if="!project" class="bs-card p-6 text-center mt-6">
      <i class="pi pi-folder-open text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">Project not found</p>
      <p class="text-sm text-[color:var(--bs-muted)]">
        It may have been removed, or you don't have access to it.
      </p>
    </div>

    <template v-else>
      <img
        v-if="project.photoUrl"
        :src="project.photoUrl"
        :alt="project.label"
        class="w-full h-40 sm:h-52 rounded-xl object-cover mt-3 mb-3"
      />
      <h1 class="text-2xl font-bold mt-3">{{ project.label }}</h1>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        For {{ project.clientName }} ·
        <template v-if="project.unit">{{ project.unit }} · </template>
        {{ liveJobCount }} {{ liveJobCount === 1 ? "job" : "jobs" }}
      </p>

      <!-- Edit mode: reuses the project form (prefilled), saving via updateProject. -->
      <NewProjectForm
        v-if="editing"
        :edit-project="project"
        class="mt-4"
        @updated="editing = false"
        @cancel="editing = false"
      />

      <template v-else>
      <!-- Add jobs to an accepted project — the client approves each before dispatch. -->
      <div v-if="canAddJobs" class="mt-4">
        <Button
          v-if="!addingJobs"
          label="Add jobs"
          icon="pi pi-plus"
          size="small"
          outlined
          @click="addingJobs = true"
        />
        <AddProjectJobsForm
          v-else
          :project-id="project.id"
          @added="addingJobs = false"
          @cancel="addingJobs = false"
        />
      </div>

      <!-- Accepted but the dispatch failed — the PM can re-send. -->
      <div v-if="myPostings.length === 0 && dispatchFailed" class="bs-card p-6 text-center mt-6 border-l-4 border-l-[color:var(--bs-warn,#d97706)]">
        <i class="pi pi-exclamation-triangle text-2xl text-[color:var(--bs-warn,#d97706)]"></i>
        <p class="mt-2 font-medium">Jobs didn't go out</p>
        <p class="text-sm text-[color:var(--bs-muted)] mb-3">
          Your client accepted, but we couldn't send the jobs to your trades. Re-send to try again.
        </p>
        <Button label="Re-send jobs" icon="pi pi-refresh" size="small" :loading="busy" @click="retryDispatch" />
      </div>

      <!-- Pending invite — the PM can resend, fix the email, or cancel. -->
      <div v-else-if="myPostings.length === 0 && isPending" class="bs-card p-5 mt-6 space-y-3">
        <div class="flex items-center gap-2">
          <i class="pi pi-clock text-[color:var(--bs-blue)]"></i>
          <p class="font-medium">
            {{ project.status === "claimed" ? "Your client joined — waiting for them to accept" : "Invite sent" }}
          </p>
        </div>
        <p v-if="project.projectInvite?.emailLower" class="text-sm text-[color:var(--bs-muted)]">
          Invited: {{ project.projectInvite.emailLower }}
        </p>
        <p class="text-xs text-[color:var(--bs-muted)]">
          Once they accept, each job goes to your matching trades and quotes show up here.
        </p>

        <!-- Every resend hands back a fresh link the PM can share directly (text/DM). -->
        <p v-if="newInviteLink" class="text-xs font-medium">Shareable sign-in link:</p>
        <div v-if="newInviteLink" class="flex items-center gap-2 flex-wrap text-sm">
          <span
            class="flex-1 min-w-0 truncate rounded border border-[color:var(--bs-border)] px-2 py-1 bg-[color:var(--bs-surface-alt)]"
          >{{ newInviteLink }}</span>
          <Button label="Copy" icon="pi pi-copy" size="small" @click="copyLink(newInviteLink)" />
        </div>

        <div v-if="confirmingCancel" class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium">Cancel this project? This can't be undone.</span>
          <Button label="Yes, cancel" severity="danger" size="small" :loading="busy" @click="doCancel" />
          <Button label="Keep it" text size="small" :disabled="busy" @click="confirmingCancel = false" />
        </div>
        <div v-else class="flex flex-wrap gap-2">
          <Button
            v-if="project.status === 'invited'"
            label="Resend invite"
            icon="pi pi-send"
            size="small"
            :loading="busy"
            @click="resendInvite()"
          />
          <Button
            v-if="project.status === 'invited'"
            label="Change email"
            icon="pi pi-pencil"
            text
            size="small"
            @click="showEmailForm = !showEmailForm"
          />
          <Button
            label="Edit project"
            icon="pi pi-pencil"
            text
            size="small"
            @click="editing = true"
          />
          <Button
            label="Cancel project"
            icon="pi pi-trash"
            text
            severity="danger"
            size="small"
            @click="confirmingCancel = true"
          />
        </div>

        <div
          v-if="showEmailForm && project.status === 'invited' && !confirmingCancel"
          class="flex flex-wrap items-end gap-2 border-t border-[color:var(--bs-border)] pt-3"
        >
          <div class="flex-1 min-w-[12rem]">
            <label class="text-xs text-[color:var(--bs-muted)]">New client email</label>
            <InputText v-model="newEmail" type="email" class="w-full mt-1" placeholder="them@example.com" />
          </div>
          <Button
            label="Update & resend"
            size="small"
            :disabled="!newEmail.trim()"
            :loading="busy"
            @click="resendInvite(newEmail.trim())"
          />
        </div>
      </div>

      <!-- Terminal states (cancelled / declined). -->
      <div v-else-if="myPostings.length === 0" class="bs-card p-6 text-center mt-6">
        <i class="pi pi-folder-open text-2xl text-[color:var(--bs-muted)]"></i>
        <p class="mt-2 font-medium">
          {{
            project.status === "declined"
              ? "Your client declined this project"
              : project.status === "cancelled"
                ? "This project was cancelled"
                : "Waiting on your client"
          }}
        </p>
      </div>

      <ul v-else class="grid grid-cols-1 gap-3 mt-6">
        <li v-for="post in myPostings" :key="post.id" class="bs-card p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="font-medium truncate">{{ post.title }}</p>
              <p class="text-xs text-[color:var(--bs-muted)]">{{ tradeLabel(post.trade) }}</p>
            </div>
            <Tag
              :value="postingStatusLabel[post.status] ?? post.status"
              :severity="postingStatusSeverity[post.status] ?? 'info'"
            />
          </div>

          <!-- Won: a contractor was picked — show the read-only job status + schedule. -->
          <div
            v-if="jobBySourcePost.get(post.id)"
            class="mt-3 border-t border-[color:var(--bs-border)] pt-3 text-sm"
          >
            <div class="flex items-center gap-2">
              <i class="pi pi-check-circle text-[color:var(--bs-success)]"></i>
              <span>
                <strong>{{ jobBySourcePost.get(post.id)!.tradespersonName }}</strong>
                · {{ statusLabel(jobBySourcePost.get(post.id)!.status) }}
              </span>
            </div>
            <div
              v-if="jobBySourcePost.get(post.id)!.scheduledStart"
              class="text-xs text-[color:var(--bs-muted)] mt-1"
            >
              Scheduled {{ date(jobBySourcePost.get(post.id)!.scheduledStart) }}
              <template v-if="jobBySourcePost.get(post.id)!.scheduledEnd">
                – {{ date(jobBySourcePost.get(post.id)!.scheduledEnd) }}
              </template>
            </div>
          </div>

          <!-- Brokering: show the incoming quotes with amounts. -->
          <div v-else class="mt-3 border-t border-[color:var(--bs-border)] pt-3">
            <!-- Empty scope: no saved trade matched this job's trade. -->
            <p
              v-if="post.status === 'invited' && (post.invitedContractorIds?.length ?? 0) === 0"
              class="text-xs text-[color:var(--bs-warn,#d97706)]"
            >
              No saved trade matched this job, so nobody was invited. Ask your client to open it to all
              trades nearby (or save a {{ tradeLabel(post.trade) }} and re-send).
            </p>
            <p v-else-if="liveQuotes(post.id).length === 0" class="text-xs text-[color:var(--bs-muted)]">
              No quotes yet. Your trades have been invited.
            </p>
            <ul v-else class="space-y-1">
              <li
                v-for="q in liveQuotes(post.id)"
                :key="q.id"
                class="flex items-center justify-between text-sm"
              >
                <span class="text-[color:var(--bs-muted)]">
                  <i class="pi pi-wrench text-xs mr-1"></i>Quote
                </span>
                <span class="font-medium">{{ money(quoteAmount(q)) }}</span>
              </li>
            </ul>
            <p class="text-[10px] text-[color:var(--bs-muted)] mt-2">
              Your client compares these and picks one. You see amounts, not the chat or invoice.
            </p>
          </div>
        </li>
      </ul>

      <!-- Jobs you added that the client hasn't decided on yet — no posting until they approve. -->
      <div v-if="pendingSpecs.length" class="mt-6">
        <h2 class="font-semibold text-sm flex items-center gap-2 mb-2">
          <i class="pi pi-clock text-[color:var(--bs-blue)]"></i> Awaiting your client's approval
        </h2>
        <ul class="grid grid-cols-1 gap-3">
          <li v-for="spec in pendingSpecs" :key="spec.id" class="bs-card p-4 border-l-4 border-l-[color:var(--bs-blue)]">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="font-medium truncate">{{ spec.title }}</p>
                <p class="text-xs text-[color:var(--bs-muted)]">{{ tradeLabel(spec.trade) }}</p>
              </div>
              <Tag value="Pending client" severity="info" />
            </div>
            <p class="text-xs text-[color:var(--bs-muted)] mt-2">
              Your client approves this before it goes out to your trades for quotes.
            </p>
          </li>
        </ul>
      </div>

      <!-- Added jobs the client declined — kept so the PM has feedback. -->
      <ul v-if="declinedSpecs.length" class="grid grid-cols-1 gap-2 mt-3">
        <li
          v-for="spec in declinedSpecs"
          :key="spec.id"
          class="bs-card p-3 flex items-center gap-3 opacity-70"
        >
          <i class="pi pi-times-circle text-[color:var(--bs-muted)]"></i>
          <div class="min-w-0 flex-1">
            <p class="font-medium truncate">{{ spec.title }}</p>
            <p class="text-xs text-[color:var(--bs-muted)]">{{ tradeLabel(spec.trade) }}</p>
          </div>
          <Tag value="Declined" severity="secondary" />
        </li>
      </ul>
      </template>
    </template>
  </section>
</template>
