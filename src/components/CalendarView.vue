<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { JobDoc, WeeklyAvailability, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  jobs: WithId<JobDoc>[];
  availability: WeeklyAvailability;
}>();
const router = useRouter();

const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const weekStart = computed(() => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // make Monday=0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
});

const jobsByDay = computed(() => {
  const map: Record<number, WithId<JobDoc>[]> = {};
  for (let i = 0; i < 7; i++) map[i] = [];
  const start = weekStart.value.getTime();
  for (const job of props.jobs) {
    if (!job.scheduledStart) continue;
    const d = job.scheduledStart.toDate();
    const idx = Math.floor((d.getTime() - start) / 86400000);
    if (idx >= 0 && idx < 7) map[idx].push(job);
  }
  return map;
});
</script>

<template>
  <div class="grid grid-cols-7 gap-2">
    <div v-for="(label, i) in dayLabels" :key="label" class="bs-card p-3 min-h-[20rem]">
      <header class="flex items-center justify-between mb-2">
        <div class="font-semibold text-sm">{{ label }}</div>
        <div class="text-xs text-[color:var(--bs-muted)]">
          {{ props.availability[days[i]].length ? `${props.availability[days[i]].length} block(s)` : "Off" }}
        </div>
      </header>
      <div
        v-for="block in props.availability[days[i]]"
        :key="block.start + block.end"
        class="text-xs bg-blue-50 text-blue-900 rounded px-2 py-1 mb-1"
      >
        {{ block.start }} – {{ block.end }}
      </div>
      <article
        v-for="job in jobsByDay[i]"
        :key="job.id"
        class="mt-2 p-2 rounded-md bg-[color:var(--bs-blue)] text-white text-xs cursor-pointer"
        @click="router.push({ name: 'JobDetail', params: { id: job.id } })"
      >
        <div class="font-medium line-clamp-1">{{ job.title }}</div>
        <div class="opacity-80 line-clamp-1">{{ job.trade }}</div>
      </article>
    </div>
  </div>
</template>
