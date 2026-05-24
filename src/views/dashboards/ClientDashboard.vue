<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import Tag from "primevue/tag";
import JobCounterparty from "@/components/JobCounterparty.vue";
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

const statusSeverity: Record<string, "info" | "success" | "warn" | "danger" | "secondary"> = {
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

const postStatusSeverity: Record<string, "info" | "success" | "warn" | "danger" | "secondary"> = {
  open: "info",
  closed: "success",
  cancelled: "secondary",
  expired: "danger",
};

const visibleJobs = computed(() => jobs.value);
const visiblePosts = computed(() => posts.value);

function formatBudget(min: number, max: number): string {
  const fmt = (cents: number) =>
    `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
  return `${fmt(min)}–${fmt(max)}`;
}
</script>

<template>
  <section class="bs-container py-8">
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h1 class="text-2xl font-bold">Welcome, {{ auth.user?.displayName }}</h1>
        <p class="text-[color:var(--bs-muted)]">Your jobs and posted requests.</p>
      </div>
      <div class="flex gap-2">
        <RouterLink to="/jobs/post">
          <Button label="Post a job" icon="pi pi-megaphone" />
        </RouterLink>
        <RouterLink to="/search">
          <Button label="Find a tradesperson" icon="pi pi-search" outlined />
        </RouterLink>
      </div>
    </div>

    <div class="mb-4">
      <SelectButton v-model="view" :options="viewOptions" option-label="label" option-value="value" />
    </div>

    <!-- MY JOBS -->
    <template v-if="view === 'jobs'">
      <div v-if="visibleJobs.length === 0" class="bs-empty">
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

      <div v-else class="grid sm:grid-cols-2 gap-4">
        <RouterLink
          v-for="job in visibleJobs"
          :key="job.id"
          :to="{ name: 'JobDetail', params: { id: job.id } }"
          class="bs-card p-5 hover:shadow-md transition-shadow no-underline text-inherit"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="font-semibold">{{ job.title }}</div>
              <div class="text-xs text-[color:var(--bs-muted)]">
                {{ tradeLabel(job.trade) }} • {{ relativeTime(job.createdAt) }}
              </div>
            </div>
            <Tag :value="job.status" :severity="statusSeverity[job.status] ?? 'info'" />
          </div>
          <p class="text-sm mt-2 text-[color:var(--bs-muted)] line-clamp-2">{{ job.description }}</p>
          <div class="mt-3 pt-3 border-t border-[color:var(--bs-border)]">
            <JobCounterparty
              role="tradesperson"
              :name="job.tradespersonName"
              :photo-url="job.tradespersonPhotoURL"
            />
          </div>
        </RouterLink>
      </div>
    </template>

    <!-- POSTED JOBS -->
    <template v-else>
      <div v-if="visiblePosts.length === 0" class="bs-empty">
        <i class="pi pi-megaphone text-3xl mb-2 block"></i>
        <p>You haven't posted any jobs yet.</p>
        <RouterLink to="/jobs/post" class="inline-block mt-3">
          <Button label="Post a job" icon="pi pi-megaphone" />
        </RouterLink>
      </div>

      <div v-else class="grid sm:grid-cols-2 gap-4">
        <RouterLink
          v-for="post in visiblePosts"
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
