<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import { subscribeClientJobs } from "@/firebase/services/jobs";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables";

const auth = useAuthStore();
const { relativeTime } = useFormatters();
const jobs = ref<WithId<JobDoc>[]>([]);
let unsub: (() => void) | null = null;

onMounted(() => {
  if (auth.fbUser) {
    unsub = subscribeClientJobs(auth.fbUser.uid, (j) => (jobs.value = j));
  }
});

onUnmounted(() => unsub?.());

const statusSeverity: Record<string, "info" | "success" | "warn" | "danger" | "secondary"> = {
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
  <section class="bs-container py-8">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold">Welcome, {{ auth.user?.displayName }}</h1>
        <p class="text-[color:var(--bs-muted)]">Your active jobs and requests.</p>
      </div>
      <RouterLink to="/search">
        <Button label="Find a tradie" icon="pi pi-search" />
      </RouterLink>
    </div>

    <div v-if="jobs.length === 0" class="bs-empty">
      <i class="pi pi-inbox text-3xl mb-2 block"></i>
      <p>No jobs yet. Start by finding a verified tradesperson.</p>
      <RouterLink to="/search" class="inline-block mt-3">
        <Button label="Browse tradies" icon="pi pi-search" />
      </RouterLink>
    </div>

    <div v-else class="grid sm:grid-cols-2 gap-4">
      <RouterLink
        v-for="job in jobs"
        :key="job.id"
        :to="{ name: 'JobDetail', params: { id: job.id } }"
        class="bs-card p-5 hover:shadow-md transition-shadow no-underline text-inherit"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="font-semibold">{{ job.title }}</div>
            <div class="text-xs text-[color:var(--bs-muted)]">{{ job.trade }} • {{ relativeTime(job.createdAt) }}</div>
          </div>
          <Tag :value="job.status" :severity="statusSeverity[job.status] ?? 'info'" />
        </div>
        <p class="text-sm mt-2 text-[color:var(--bs-muted)] line-clamp-2">{{ job.description }}</p>
      </RouterLink>
    </div>
  </section>
</template>
