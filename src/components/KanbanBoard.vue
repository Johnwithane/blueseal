<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { JobDoc, JobStatus, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import JobCounterparty from "@/components/JobCounterparty.vue";

const props = defineProps<{ jobs: WithId<JobDoc>[] }>();
const router = useRouter();
const { relativeTime } = useFormatters();

interface Column {
  key: JobStatus;
  label: string;
  color: string;
}

// Read-only pipeline view. Status moves automatically through the real
// flow (send-quote → client-accepts → active → finish-job → approve →
// pay), so this board purely visualises where each job sits. Cards are
// clickable to open the job page.
const columns: Column[] = [
  { key: "accepted", label: "Accepted (awaiting brief)", color: "#a0d6f1" },
  { key: "requested", label: "Inbox", color: "#0ea5e9" },
  { key: "quoted", label: "Quoted", color: "#f59e0b" },
  { key: "awaiting_upfront_payment", label: "Awaiting upfront", color: "#d97706" },
  { key: "in_progress", label: "In progress", color: "#0d47a1" },
  { key: "awaiting_client_approval", label: "Awaiting approval", color: "#f97316" },
  { key: "awaiting_payment", label: "Awaiting payment", color: "#7c3aed" },
  { key: "complete", label: "Complete", color: "#6b7280" },
];

const byColumn = computed(() => {
  const m: Record<string, WithId<JobDoc>[]> = {};
  for (const c of columns) m[c.key] = [];
  for (const job of props.jobs) {
    if (job.status === "reviewed" || job.status === "cancelled") continue;
    (m[job.status] ??= []).push(job);
  }
  return m;
});
</script>

<template>
  <div class="overflow-x-auto -mx-4 px-4 pb-2">
    <div class="grid grid-cols-[repeat(8,minmax(240px,1fr))] gap-3 min-w-[1920px]">
      <section
        v-for="col in columns"
        :key="col.key"
        class="bg-[#f9fafb] rounded-xl p-3 min-h-[60vh]"
      >
        <header class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="h-2.5 w-2.5 rounded-full" :style="{ background: col.color }"></span>
            <span class="font-semibold text-sm">{{ col.label }}</span>
          </div>
          <span class="text-xs text-[color:var(--bs-muted)]">{{ byColumn[col.key].length }}</span>
        </header>

        <article
          v-for="job in byColumn[col.key]"
          :key="job.id"
          class="bs-card p-3 mb-2 cursor-pointer"
          @click="router.push({ name: 'JobDetail', params: { id: job.id } })"
        >
          <div class="font-medium text-sm line-clamp-1">{{ job.title }}</div>
          <div class="text-xs text-[color:var(--bs-muted)] mt-1">
            {{ job.trade }} • {{ relativeTime(job.createdAt) }}
          </div>
          <div v-if="job.scheduledStart" class="text-xs mt-1 text-[color:var(--bs-blue)]">
            <i class="pi pi-calendar text-[10px]"></i>
            Scheduled
          </div>
          <div class="mt-2 pt-2 border-t border-[color:var(--bs-border)]">
            <JobCounterparty
              role="client"
              size="small"
              :name="job.clientName"
              :photo-url="job.clientPhotoURL"
            />
          </div>
        </article>
      </section>
    </div>
  </div>
</template>
