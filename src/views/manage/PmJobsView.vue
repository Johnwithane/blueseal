<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import Tag from "primevue/tag";
import Button from "primevue/button";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import { useFormatters } from "@/composables";
import { humanizeError } from "@/utils/errors";
import { subscribeProjectJobsForPm } from "@/firebase/services/jobs";
import { statusLabel, STATUS_SEVERITY } from "@/utils/jobStatus";
import { tradeLabel } from "@/data/trades";
import type { JobDoc, WithId } from "@/firebase/interfaces";

// A flat, read-only board of every job the PM drove (drivenByProjectManagerId),
// across all properties + projects. The detail lives in the project view; this is
// the at-a-glance status board.
const auth = useAuthStore();
const { date } = useFormatters();
useSeo({ title: "Jobs", noindex: true });

const jobs = ref<WithId<JobDoc>[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
let unsub: (() => void) | null = null;

function start() {
  const uid = auth.fbUser?.uid;
  if (!uid) {
    loading.value = false;
    return;
  }
  loading.value = true;
  loadError.value = null;
  unsub?.();
  unsub = subscribeProjectJobsForPm(
    uid,
    (j) => {
      jobs.value = j;
      loading.value = false;
    },
    // Clear the spinner and offer a retry instead of hanging on "Loading…"
    // forever if the subscription errors (P2-06).
    (e) => {
      loadError.value = humanizeError(e);
      loading.value = false;
    },
  );
}
onMounted(start);
onUnmounted(() => unsub?.());

const hasJobs = computed(() => jobs.value.length > 0);
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <h1 class="text-2xl font-bold mb-1">Jobs</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mb-5">
      Every trade job across your projects, read-only. You see status and schedule, never the chat or
      invoice.
    </p>

    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)] py-6 text-center">Loading…</div>
    <div v-else-if="loadError" class="bs-card p-6 text-center">
      <i class="pi pi-exclamation-triangle text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">Couldn't load your jobs</p>
      <p class="text-sm text-[color:var(--bs-muted)]">{{ loadError }}</p>
      <Button label="Try again" icon="pi pi-refresh" size="small" class="mt-3" @click="start" />
    </div>
    <div v-else-if="!hasJobs" class="bs-card p-6 text-center">
      <i class="pi pi-briefcase text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">No jobs yet</p>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Once a client accepts a project and picks one of your trades, the job shows up here.
      </p>
    </div>
    <ul v-else class="grid grid-cols-1 gap-2">
      <li v-for="j in jobs" :key="j.id" class="bs-card p-3 flex items-center gap-3">
        <i class="pi pi-wrench text-[color:var(--bs-blue)]"></i>
        <div class="min-w-0 flex-1">
          <p class="font-medium truncate">{{ j.title }}</p>
          <p class="text-xs text-[color:var(--bs-muted)] truncate">
            {{ tradeLabel(j.trade) }}<template v-if="j.tradespersonName"> · {{ j.tradespersonName }}</template>
            <template v-if="j.scheduledStart"> · {{ date(j.scheduledStart) }}</template>
          </p>
        </div>
        <Tag :value="statusLabel(j.status)" :severity="STATUS_SEVERITY[j.status] ?? 'info'" />
      </li>
    </ul>
  </section>
</template>
