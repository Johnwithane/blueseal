<script setup lang="ts">
// Per-client job history rollup. Queries jobs linked to this contact
// (clientRef) — recurring backing jobs included — and lists them newest first,
// each linking into the existing job detail. Read-only.
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import Tag from "primevue/tag";
import { listClientJobs } from "@/firebase/services/clientsService";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import { useToast } from "@/composables/useToast";
import type { JobDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{ tradieUid: string; clientId: string }>();

const { date } = useFormatters();
const toast = useToast();
const jobs = ref<WithId<JobDoc>[]>([]);
const loading = ref(true);

// Recurring backing jobs are billing vehicles, not real jobs — they're shown
// in the Recurring billing section, so keep them out of the history list.
const realJobs = computed(() => jobs.value.filter((j) => j.originType !== "recurring_plan"));

async function load() {
  loading.value = true;
  try {
    jobs.value = await listClientJobs(props.tradieUid, props.clientId);
  } catch (e) {
    toast.error("Couldn't load history", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.clientId, load);
</script>

<template>
  <div>
    <h3 class="text-sm font-semibold mb-2">Job history</h3>
    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)]">
      <i class="pi pi-spin pi-spinner mr-1"></i> Loading…
    </div>
    <ul v-else-if="realJobs.length" class="space-y-2">
      <li v-for="j in realJobs" :key="j.id">
        <RouterLink
          :to="`/jobs/${j.id}`"
          class="bs-card p-3 flex items-center gap-2 hover:border-[color:var(--bs-blue)]"
        >
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate">{{ j.title || j.trade }}</div>
            <div class="text-xs text-[color:var(--bs-muted)]">{{ date(j.createdAt) }}</div>
          </div>
          <Tag :value="j.status" />
        </RouterLink>
      </li>
    </ul>
    <p v-else class="text-sm text-[color:var(--bs-muted)]">
      No jobs with this client yet. New jobs you link to them will show up here.
    </p>
  </div>
</template>
