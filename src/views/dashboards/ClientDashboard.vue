<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import Tag from "primevue/tag";
import JobList from "@/components/JobList.vue";
import { useAuthStore } from "@/stores/auth";
import { subscribeClientJobs } from "@/firebase/services/jobs";
import { subscribeMyJobPosts } from "@/firebase/services/jobPosts";
import type { JobDoc, JobPostDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables";
import { tradeLabel } from "@/data/trades";

const auth = useAuthStore();
const { relativeTime } = useFormatters();
const jobs = ref<WithId<JobDoc>[]>([]);
const posts = ref<WithId<JobPostDoc>[]>([]);
const view = ref<"jobs" | "posts">("jobs");
const viewOptions = [
  { label: "My jobs", value: "jobs" },
  { label: "Posted jobs", value: "posts" },
];

// Per-party archive view for "My jobs". Posts have their own status
// lifecycle (open / closed / cancelled / expired) and aren't archived
// per-party — kept out of this toggle for now.
const showArchived = ref(false);

let unsubJobs: (() => void) | null = null;
let unsubPosts: (() => void) | null = null;

onMounted(() => {
  if (auth.fbUser) {
    unsubJobs = subscribeClientJobs(auth.fbUser.uid, (j) => (jobs.value = j));
    unsubPosts = subscribeMyJobPosts(auth.fbUser.uid, (p) => (posts.value = p));
  }
});

onUnmounted(() => {
  unsubJobs?.();
  unsubPosts?.();
});

const postStatusSeverity: Record<string, "info" | "success" | "warn" | "danger" | "secondary"> = {
  open: "info",
  closed: "success",
  cancelled: "secondary",
  expired: "danger",
};

// Has the client archived anything? Used to hide the "View archived"
// button on accounts that haven't touched any jobs yet — avoids a dead
// button on day one.
const hasArchived = computed(() =>
  jobs.value.some((j) => j.clientArchivedAt != null),
);

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

    <div class="mb-3">
      <SelectButton v-model="view" :options="viewOptions" option-label="label" option-value="value" />
    </div>

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
      </div>

      <template v-else>
        <div
          v-if="hasArchived || showArchived"
          class="mb-3 flex items-center justify-end"
        >
          <Button
            :label="showArchived ? 'Back to active jobs' : 'View completed'"
            :icon="showArchived ? 'pi pi-arrow-left' : 'pi pi-check-circle'"
            text
            size="small"
            @click="showArchived = !showArchived"
          />
        </div>
        <JobList :jobs="jobs" viewer-role="client" :show-archived="showArchived" />
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

      <div v-else class="grid sm:grid-cols-2 gap-4">
        <RouterLink
          v-for="post in posts"
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
        </RouterLink>
      </div>
    </template>
  </section>
</template>
