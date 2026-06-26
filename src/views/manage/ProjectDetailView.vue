<script setup lang="ts">
// PM read-only project visibility (P3b-3). The owning project manager sees, per
// job in the project: the scoped posting's status, the incoming quotes WITH amounts
// (to broker the client's compare-and-choose), and once a contractor is picked, the
// won job's status + schedule. Strictly read-only: no chat, and the live invoice
// stays firewalled (rules expose only the job doc, never chats/ or invoices/).
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import { useFormatters } from "@/composables";
import { subscribeProject } from "@/firebase/services/projects";
import { subscribeProjectPostingsForPm } from "@/firebase/services/jobPosts";
import { subscribeProjectJobsForPm } from "@/firebase/services/jobs";
import { subscribeApplicationsForPost } from "@/firebase/services/applications";
import { tradeLabel } from "@/data/trades";
import { statusLabel } from "@/utils/jobStatus";
import type {
  ApplicationDoc,
  JobDoc,
  JobPostDoc,
  ProjectDoc,
  WithId,
} from "@/firebase/interfaces";

const route = useRoute();
const auth = useAuthStore();
const { money, date } = useFormatters();
useSeo({ title: "Project", noindex: true });

const projectId = String(route.params.projectId ?? "");
const project = ref<WithId<ProjectDoc> | null>(null);
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

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!projectId || !uid) return;
  unsubProject = subscribeProject(projectId, (p) => (project.value = p));
  unsubPostings = subscribeProjectPostingsForPm(uid, (p) => (postings.value = p));
  unsubJobs = subscribeProjectJobsForPm(uid, (j) => (jobs.value = j));
});
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

    <div v-if="!project" class="text-sm text-[color:var(--bs-muted)] py-8 text-center">Loading…</div>

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
        {{ project.jobSpecs.length }} {{ project.jobSpecs.length === 1 ? "job" : "jobs" }}
      </p>

      <!-- Before the client accepts, there are no postings yet. -->
      <div v-if="myPostings.length === 0" class="bs-card p-6 text-center mt-6">
        <i class="pi pi-clock text-2xl text-[color:var(--bs-muted)]"></i>
        <p class="mt-2 font-medium">Waiting on your client</p>
        <p class="text-sm text-[color:var(--bs-muted)]">
          Once they accept, each job goes to your matching trades and quotes show up here.
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
            <p v-if="liveQuotes(post.id).length === 0" class="text-xs text-[color:var(--bs-muted)]">
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
    </template>
  </section>
</template>
