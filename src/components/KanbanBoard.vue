<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { JobDoc, JobStatus, WithId } from "@/firebase/interfaces";
import { updateJobStatus } from "@/firebase/services/jobs";
import { useConfirm } from "primevue/useconfirm";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";

const props = defineProps<{ jobs: WithId<JobDoc>[] }>();
const router = useRouter();
const confirm = useConfirm();
const toast = useToast();
const { relativeTime } = useFormatters();

interface Column {
  key: JobStatus;
  label: string;
  color: string;
}

const columns: Column[] = [
  { key: "requested", label: "Inbox", color: "#0ea5e9" },
  { key: "quoted", label: "Quoted", color: "#f59e0b" },
  { key: "scheduled", label: "Scheduled", color: "#16a34a" },
  { key: "in_progress", label: "In progress", color: "#0d47a1" },
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

function onDragStart(e: DragEvent, jobId: string) {
  e.dataTransfer?.setData("text/plain", jobId);
  e.dataTransfer!.effectAllowed = "move";
}

function onDrop(e: DragEvent, target: JobStatus) {
  e.preventDefault();
  const id = e.dataTransfer?.getData("text/plain");
  if (!id) return;
  const job = props.jobs.find((j) => j.id === id);
  if (!job || job.status === target) return;
  // Moving to Complete triggers invoice draft via Cloud Function — confirm first.
  if (target === "complete") {
    confirm.require({
      message: "Mark this job complete? A draft invoice will be created automatically.",
      header: "Mark complete",
      icon: "pi pi-check",
      acceptLabel: "Mark complete",
      rejectLabel: "Cancel",
      accept: async () => {
        await updateJobStatus(id, target);
        toast.success("Job moved", "Draft invoice created.");
      },
    });
    return;
  }
  updateJobStatus(id, target);
}
</script>

<template>
  <div class="overflow-x-auto -mx-4 px-4 pb-2">
    <div class="grid grid-cols-[repeat(6,minmax(240px,1fr))] gap-3 min-w-[1440px]">
      <section
        v-for="col in columns"
        :key="col.key"
        class="bg-[#f9fafb] rounded-xl p-3 min-h-[60vh]"
        @dragover.prevent
        @drop="onDrop($event, col.key)"
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
          draggable="true"
          class="bs-card p-3 mb-2 cursor-grab"
          @dragstart="onDragStart($event, job.id)"
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
        </article>
      </section>
    </div>
  </div>
</template>
