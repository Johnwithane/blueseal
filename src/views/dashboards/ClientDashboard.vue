<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import Tag from "primevue/tag";
import JobList from "@/components/JobList.vue";
import TrustedTradesPanel from "@/components/TrustedTradesPanel.vue";
import ClientProjectsPanel from "@/components/ClientProjectsPanel.vue";
import { useAuthStore } from "@/stores/auth";
import { subscribeClientJobs } from "@/firebase/services/jobs";
import { subscribeMyJobPosts, subscribeJobPostMeta } from "@/firebase/services/jobPosts";
import type { JobDoc, JobPostDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables";
import { tradeLabel } from "@/data/trades";

const auth = useAuthStore();
const { relativeTime } = useFormatters();
const jobs = ref<WithId<JobDoc>[]>([]);
const posts = ref<WithId<JobPostDoc>[]>([]);
const view = ref<"jobs" | "posts" | "trades">("jobs");
const viewOptions = [
  { label: "My jobs", value: "jobs" },
  { label: "Posted jobs", value: "posts" },
  { label: "Saved trades", value: "trades" },
];

// Completed view for "My jobs": flips JobList to the terminal-status
// partition (complete / reviewed / cancelled) — filing is automatic.
// Posts have their own status lifecycle (open / closed / cancelled /
// expired) and are kept out of this toggle.
const showCompleted = ref(false);
// Posted-jobs: only "open" posts are actionable; closed/cancelled/expired ones
// accumulate, so hide them behind a toggle (mirrors showCompleted above).
const showInactivePosts = ref(false);

// Live applicant counts per OPEN post, read from each post's denormalized
// jobPostMeta.applicationCount (same source the post-detail page uses). Lets us
// surface "N applicants waiting" both as a tab badge and on each card — so a
// client never misses that a vetted pro is waiting on them (the "My jobs"
// default tab otherwise reads "No active jobs").
const applicantCounts = ref<Record<string, number>>({});
const metaUnsubs = new Map<string, () => void>();

function syncMetaSubs(current: WithId<JobPostDoc>[]): void {
  const openIds = new Set(current.filter((p) => p.status === "open").map((p) => p.id));
  // Drop subs for posts that closed or disappeared.
  for (const [id, unsub] of metaUnsubs) {
    if (!openIds.has(id)) {
      unsub();
      metaUnsubs.delete(id);
      const next = { ...applicantCounts.value };
      delete next[id];
      applicantCounts.value = next;
    }
  }
  // Add subs for newly-open posts.
  for (const id of openIds) {
    if (!metaUnsubs.has(id)) {
      metaUnsubs.set(
        id,
        subscribeJobPostMeta(id, (m) => {
          applicantCounts.value = { ...applicantCounts.value, [id]: m?.applicationCount ?? 0 };
        }),
      );
    }
  }
}

const openPosts = computed(() => posts.value.filter((p) => p.status === "open"));
const inactivePosts = computed(() => posts.value.filter((p) => p.status !== "open"));
const totalApplicants = computed(() =>
  openPosts.value.reduce((sum, p) => sum + (applicantCounts.value[p.id] ?? 0), 0),
);

let unsubJobs: (() => void) | null = null;
let unsubPosts: (() => void) | null = null;

onMounted(() => {
  if (auth.fbUser) {
    unsubJobs = subscribeClientJobs(auth.fbUser.uid, (j) => (jobs.value = j));
    unsubPosts = subscribeMyJobPosts(auth.fbUser.uid, (p) => {
      posts.value = p;
      syncMetaSubs(p);
    });
  }
});

onUnmounted(() => {
  unsubJobs?.();
  unsubPosts?.();
  metaUnsubs.forEach((unsub) => unsub());
  metaUnsubs.clear();
});

const postStatusSeverity: Record<string, "info" | "success" | "warn" | "danger" | "secondary"> = {
  open: "info",
  closed: "success",
  cancelled: "secondary",
  expired: "danger",
};

// Does the client have any finished jobs? Used to hide the "View
// completed" button on accounts that haven't finished any jobs yet —
// avoids a dead button on day one.
const TERMINAL = new Set<JobDoc["status"]>(["complete", "reviewed", "cancelled"]);
const hasCompleted = computed(() => jobs.value.some((j) => TERMINAL.has(j.status)));

function formatBudget(min: number, max: number): string {
  const fmt = (cents: number) =>
    `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
  return `${fmt(min)}–${fmt(max)}`;
}
</script>

<template>
  <section class="bs-container pb-8 pt-3">
    <!-- "Post a job" sits on the title row (top-right). Find-a-tradesperson is
         reached via the Search tab in the bottom nav, so it's no longer a
         header button here. -->
    <Teleport defer to="#app-shell-header-action">
      <RouterLink to="/jobs/post">
        <Button label="Post a job" icon="pi pi-megaphone" size="small" />
      </RouterLink>
    </Teleport>

    <!-- Projects a project manager set up for this client (claimed → needs an
         accept/decision). Renders nothing when there are none. -->
    <ClientProjectsPanel />

    <div class="mb-3">
      <SelectButton
        v-model="view"
        :options="viewOptions"
        option-label="label"
        option-value="value"
        data-key="value"
      >
        <template #option="{ option }">
          <span>{{ option.label }}</span>
          <span
            v-if="option.value === 'posts' && totalApplicants > 0"
            class="ml-1.5 inline-flex items-center justify-center rounded-full bg-[color:var(--bs-blue)] px-1.5 py-0.5 text-[0.65rem] font-semibold leading-none text-white"
            :aria-label="`${totalApplicants} applicants waiting`"
          >{{ totalApplicants }}</span>
        </template>
      </SelectButton>
    </div>

    <!-- SAVED TRADES (universal: re-hire trades you trust) -->
    <TrustedTradesPanel v-if="view === 'trades'" />

    <!-- MY JOBS -->
    <template v-if="view === 'jobs'">
      <div
        v-if="jobs.length === 0"
        class="bs-empty"
      >
        <i class="pi pi-inbox text-3xl mb-2 block"></i>
        <p>No active jobs. Post a job to get bids, or pick a specific tradesperson to send a direct request.</p>
        <div class="flex gap-2 justify-center mt-3">
          <RouterLink to="/jobs/post">
            <Button label="Post a job" icon="pi pi-megaphone" />
          </RouterLink>
          <RouterLink to="/search">
            <Button label="Browse tradespeople" icon="pi pi-search" outlined />
          </RouterLink>
        </div>
        <!-- A posted job (with its applicants) lives on the other tab — make
             sure it's never invisible behind this "no active jobs" copy. -->
        <p v-if="openPosts.length" class="mt-4 text-sm">
          <button
            type="button"
            class="font-medium text-[color:var(--bs-blue)] underline"
            @click="view = 'posts'"
          >
            You have {{ openPosts.length }} open job
            {{ openPosts.length === 1 ? "post" : "posts" }}<template v-if="totalApplicants > 0">
              with {{ totalApplicants }}
              {{ totalApplicants === 1 ? "applicant" : "applicants" }} waiting</template> →
          </button>
        </p>
      </div>

      <template v-else>
        <div
          v-if="hasCompleted || showCompleted"
          class="mb-3 flex items-center justify-end"
        >
          <Button
            :label="showCompleted ? 'Back to active jobs' : 'View completed'"
            :icon="showCompleted ? 'pi pi-arrow-left' : 'pi pi-check-circle'"
            text
            size="small"
            @click="showCompleted = !showCompleted"
          />
        </div>
        <JobList :jobs="jobs" viewer-role="client" :show-completed="showCompleted" />
      </template>
    </template>

    <!-- POSTED JOBS -->
    <template v-else>
      <div v-if="posts.length === 0" class="bs-empty">
        <i class="pi pi-megaphone text-3xl mb-2 block"></i>
        <p>You haven't posted any jobs yet.</p>
        <RouterLink to="/jobs/post" class="inline-block mt-3">
          <Button label="Post a job" icon="pi pi-megaphone" />
        </RouterLink>
      </div>

      <template v-else>
        <!-- Open posts first — actionable, with live applicant counts. -->
        <div v-if="openPosts.length" class="grid sm:grid-cols-2 gap-4">
          <RouterLink
            v-for="post in openPosts"
            :key="post.id"
            :to="{ name: 'JobPostDetail', params: { postId: post.id } }"
            class="bs-card p-5 hover:shadow-md transition-shadow no-underline text-inherit"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="font-semibold">{{ post.title }}</div>
                <div class="text-xs text-[color:var(--bs-muted)]">
                  {{ tradeLabel(post.trade) }} • {{ relativeTime(post.createdAt) }}
                </div>
              </div>
              <Tag :value="post.status" :severity="postStatusSeverity[post.status] ?? 'info'" />
            </div>
            <p class="text-sm mt-2 text-[color:var(--bs-muted)] line-clamp-2">{{ post.description }}</p>
            <div class="text-xs text-[color:var(--bs-muted)] mt-2">
              Budget {{ formatBudget(post.budget.min, post.budget.max) }} ·
              {{ post.addressPublic.city }}, {{ post.addressPublic.region }}
            </div>
            <!-- Live applicant count (UX-5) — highlighted when someone's waiting. -->
            <div
              class="mt-2 flex items-center gap-1.5 text-xs"
              :class="
                (applicantCounts[post.id] ?? 0) > 0
                  ? 'font-semibold text-[color:var(--bs-blue)]'
                  : 'text-[color:var(--bs-muted)]'
              "
            >
              <i class="pi pi-users" aria-hidden="true"></i>
              <span>
                {{ applicantCounts[post.id] ?? 0 }}
                {{ (applicantCounts[post.id] ?? 0) === 1 ? "applicant" : "applicants" }}
              </span>
              <span v-if="(applicantCounts[post.id] ?? 0) > 0">· tap to review</span>
            </div>
          </RouterLink>
        </div>
        <div v-else class="bs-empty">
          <p>No open posts right now. Reposting is quick if you need quotes again.</p>
        </div>

        <!-- Closed / cancelled / expired posts, collapsed by default (UX-5). -->
        <div v-if="inactivePosts.length" class="mt-4">
          <Button
            :label="
              showInactivePosts
                ? `Hide closed (${inactivePosts.length})`
                : `Show closed (${inactivePosts.length})`
            "
            :icon="showInactivePosts ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
            text
            size="small"
            @click="showInactivePosts = !showInactivePosts"
          />
          <div v-if="showInactivePosts" class="grid sm:grid-cols-2 gap-4 mt-2">
            <RouterLink
              v-for="post in inactivePosts"
              :key="post.id"
              :to="{ name: 'JobPostDetail', params: { postId: post.id } }"
              class="bs-card p-5 opacity-70 hover:shadow-md transition-shadow no-underline text-inherit"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="font-semibold">{{ post.title }}</div>
                  <div class="text-xs text-[color:var(--bs-muted)]">
                    {{ tradeLabel(post.trade) }} • {{ relativeTime(post.createdAt) }}
                  </div>
                </div>
                <Tag :value="post.status" :severity="postStatusSeverity[post.status] ?? 'info'" />
              </div>
              <p class="text-sm mt-2 text-[color:var(--bs-muted)] line-clamp-2">{{ post.description }}</p>
              <div class="text-xs text-[color:var(--bs-muted)] mt-2">
                Budget {{ formatBudget(post.budget.min, post.budget.max) }} ·
                {{ post.addressPublic.city }}, {{ post.addressPublic.region }}
              </div>
            </RouterLink>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>
