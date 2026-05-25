<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import Tag from "primevue/tag";
import type { JobDoc, JobStatus, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import JobCounterparty from "@/components/JobCounterparty.vue";

const props = defineProps<{ jobs: WithId<JobDoc>[] }>();
const router = useRouter();
const { relativeTime, dateTime } = useFormatters();

interface Section {
  key: JobStatus;
  label: string;
  color: string;
}

// Mirrors KanbanBoard column order so the two views feel like the same data
// in two layouts. Keep them in sync if columns change there.
const sections: Section[] = [
  { key: "accepted", label: "Accepted (awaiting brief)", color: "#a0d6f1" },
  { key: "requested", label: "Inbox", color: "#0ea5e9" },
  { key: "quoted", label: "Quoted", color: "#f59e0b" },
  { key: "in_progress", label: "In progress", color: "#0d47a1" },
  { key: "awaiting_client_approval", label: "Awaiting approval", color: "#f97316" },
  { key: "awaiting_payment", label: "Awaiting payment", color: "#7c3aed" },
  { key: "complete", label: "Complete", color: "#6b7280" },
];

const grouped = computed(() => {
  const m: Record<string, WithId<JobDoc>[]> = {};
  for (const s of sections) m[s.key] = [];
  for (const job of props.jobs) {
    if (job.status === "reviewed" || job.status === "cancelled") continue;
    (m[job.status] ??= []).push(job);
  }
  return m;
});

// Only show sections that have at least one job — keeps the list tight on
// mobile where empty headers would dominate.
const visibleSections = computed(() =>
  sections.filter((s) => grouped.value[s.key].length > 0),
);

const totalVisible = computed(() =>
  visibleSections.value.reduce((n, s) => n + grouped.value[s.key].length, 0),
);

const urgencyTone: Record<string, "info" | "warn" | "danger"> = {
  flexible: "info",
  this_week: "warn",
  urgent: "danger",
};

function urgencyLabel(u: string): string {
  if (u === "this_week") return "This week";
  if (u === "urgent") return "Urgent";
  return "Flexible";
}

function openJob(id: string) {
  router.push({ name: "JobDetail", params: { id } });
}
</script>

<template>
  <div v-if="totalVisible === 0" class="bs-empty">
    <i class="pi pi-inbox text-3xl mb-2 block"></i>
    <p>No jobs yet. New requests will appear here.</p>
  </div>
  <div v-else class="space-y-5">
    <section
      v-for="s in visibleSections"
      :key="s.key"
    >
      <header class="mb-2 flex items-center gap-2">
        <span class="h-2.5 w-2.5 rounded-full" :style="{ background: s.color }"></span>
        <h2 class="text-sm font-semibold">{{ s.label }}</h2>
        <span class="text-xs text-[color:var(--bs-muted)]">{{ grouped[s.key].length }}</span>
      </header>
      <ul class="space-y-2">
        <li
          v-for="job in grouped[s.key]"
          :key="job.id"
          class="bs-card cursor-pointer p-3 transition hover:border-[color:var(--bs-blue)]"
          tabindex="0"
          role="button"
          @click="openJob(job.id)"
          @keydown.enter="openJob(job.id)"
          @keydown.space.prevent="openJob(job.id)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="line-clamp-1 text-sm font-medium">{{ job.title }}</div>
              <div class="mt-0.5 text-xs text-[color:var(--bs-muted)]">{{ job.trade }}</div>
            </div>
            <Tag
              v-if="job.urgency !== 'flexible'"
              :value="urgencyLabel(job.urgency)"
              :severity="urgencyTone[job.urgency] ?? 'info'"
            />
          </div>
          <div class="mt-2 flex items-center justify-between gap-2">
            <JobCounterparty
              role="client"
              size="small"
              :name="job.clientName"
              :photo-url="job.clientPhotoURL"
            />
            <div class="shrink-0 text-xs text-[color:var(--bs-muted)]">
              <span v-if="job.scheduledStart" class="text-[color:var(--bs-blue)]">
                <i class="pi pi-calendar text-[10px]"></i>
                {{ dateTime(job.scheduledStart) }}
              </span>
              <span v-else>{{ relativeTime(job.createdAt) }}</span>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
