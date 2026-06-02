<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import Tag from "primevue/tag";
import Button from "primevue/button";
import type { JobDoc, JobStatus, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { archiveJob, unarchiveJob } from "@/firebase/services/jobs";
import { STATUS_LABEL, STATUS_SEVERITY } from "@/utils/jobStatus";
import { tradeLabel } from "@/data/trades";
import JobCounterparty from "@/components/JobCounterparty.vue";

const props = withDefaults(
  defineProps<{
    jobs: WithId<JobDoc>[];
    /**
     * Which side of the job the viewer is on. Drives which counterparty
     * is rendered (client view shows the tradesperson, tradesperson view
     * shows the client) and which archive field is mutated.
     */
    viewerRole: "client" | "tradesperson";
    /**
     * When true, only archived jobs are shown (and the archive button
     * flips to "restore"). Defaults to the non-archived view.
     */
    showArchived?: boolean;
  }>(),
  { showArchived: false },
);

const router = useRouter();
const { relativeTime, dateTime } = useFormatters();
const toast = useToast();

// All statuses worth surfacing on the dashboard, in pipeline order.
// "reviewed" and "cancelled" used to be filtered out — they're now
// kept so the dashboard reflects the job's full lifecycle. Archive
// (per-party, optional) is how a user hides one for good.
const STATUSES: JobStatus[] = [
  "requested",
  "accepted",
  "quoted",
  "awaiting_upfront_payment",
  "in_progress",
  "awaiting_client_approval",
  "awaiting_payment",
  "complete",
  "reviewed",
  "cancelled",
];

// Section header label varies by viewer — "requested" means "inbox" to
// a tradesperson but "sent, awaiting acceptance" to a client.
const SECTION_LABEL: Record<JobStatus, { client: string; tradesperson: string }> = {
  requested: { client: "Sent", tradesperson: "Inbox" },
  accepted: {
    client: "Accepted (intake needed)",
    tradesperson: "Accepted (awaiting brief)",
  },
  quoted: { client: "Quoted", tradesperson: "Quoted" },
  awaiting_upfront_payment: {
    client: "Upfront fee due",
    tradesperson: "Awaiting upfront fee",
  },
  in_progress: { client: "In progress", tradesperson: "In progress" },
  awaiting_client_approval: {
    client: "Awaiting your approval",
    tradesperson: "Awaiting approval",
  },
  awaiting_payment: {
    client: "Awaiting payment",
    tradesperson: "Awaiting payment",
  },
  complete: { client: "Complete", tradesperson: "Complete" },
  reviewed: { client: "Reviewed", tradesperson: "Reviewed" },
  cancelled: { client: "Cancelled", tradesperson: "Cancelled" },
};

// Per-status accent. Values live in main.css (--bs-status-*) so the kanban
// dots and these list section colours share one source of truth.
const SECTION_COLOR: Record<JobStatus, string> = {
  requested: "var(--bs-status-requested)",
  accepted: "var(--bs-status-accepted)",
  quoted: "var(--bs-status-quoted)",
  awaiting_upfront_payment: "var(--bs-status-awaiting_upfront_payment)",
  in_progress: "var(--bs-status-in_progress)",
  awaiting_client_approval: "var(--bs-status-awaiting_client_approval)",
  awaiting_payment: "var(--bs-status-awaiting_payment)",
  complete: "var(--bs-status-complete)",
  reviewed: "var(--bs-status-reviewed)",
  cancelled: "var(--bs-status-cancelled)",
};

const filter = ref<"all" | JobStatus>("all");

function isArchived(job: WithId<JobDoc>): boolean {
  const field =
    props.viewerRole === "client" ? job.clientArchivedAt : job.tradespersonArchivedAt;
  return field != null;
}

// Archive partition: default view hides archived; showArchived flips it.
const archiveFiltered = computed(() =>
  props.jobs.filter((j) => isArchived(j) === props.showArchived),
);

// Counts per status from the archive-filtered set so chip badges track
// the current view (e.g. the archived view shows counts of archived jobs).
const counts = computed(() => {
  const m: Record<JobStatus, number> = {
    requested: 0,
    accepted: 0,
    quoted: 0,
    awaiting_upfront_payment: 0,
    in_progress: 0,
    awaiting_client_approval: 0,
    awaiting_payment: 0,
    complete: 0,
    reviewed: 0,
    cancelled: 0,
  };
  for (const j of archiveFiltered.value) m[j.status] += 1;
  return m;
});

const totalCount = computed(() => archiveFiltered.value.length);

// Chip row: "All" first, then any status with at least one match so the
// row stays compact on mobile.
const chipOptions = computed(() => {
  const opts: { value: "all" | JobStatus; label: string; count: number; color: string }[] = [
    { value: "all", label: "All", count: totalCount.value, color: "var(--bs-blue)" },
  ];
  for (const s of STATUSES) {
    if (counts.value[s] === 0) continue;
    opts.push({
      value: s,
      label: SECTION_LABEL[s][props.viewerRole],
      count: counts.value[s],
      color: SECTION_COLOR[s],
    });
  }
  return opts;
});

// After the status filter, group into sections in pipeline order.
const visibleSections = computed(() => {
  const sections: { key: JobStatus; jobs: WithId<JobDoc>[] }[] = [];
  for (const s of STATUSES) {
    if (filter.value !== "all" && filter.value !== s) continue;
    const matching = archiveFiltered.value.filter((j) => j.status === s);
    if (matching.length === 0) continue;
    sections.push({ key: s, jobs: matching });
  }
  return sections;
});

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

// Archive is offered only on terminal-state cards. Rules don't enforce
// this — at the schema level any-status archive is permitted — but
// hiding an in-flight job from your own dashboard is a footgun, so the
// UI keeps the button to states where the job is genuinely done.
const ARCHIVABLE: ReadonlySet<JobStatus> = new Set([
  "complete",
  "reviewed",
  "cancelled",
]);

async function toggleArchive(job: WithId<JobDoc>) {
  try {
    if (isArchived(job)) {
      await unarchiveJob(job.id, props.viewerRole);
      toast.success("Job restored");
    } else {
      await archiveJob(job.id, props.viewerRole);
      toast.success("Job archived");
    }
  } catch (e) {
    toast.error(humanizeError(e));
  }
}

function openJob(id: string) {
  router.push({ name: "JobDetail", params: { id } });
}

function counterpartyName(job: WithId<JobDoc>): string | null | undefined {
  return props.viewerRole === "client" ? job.tradespersonName : job.clientName;
}
function counterpartyPhoto(job: WithId<JobDoc>): string | null | undefined {
  return props.viewerRole === "client" ? job.tradespersonPhotoURL : job.clientPhotoURL;
}
</script>

<template>
  <div v-if="props.jobs.length === 0" class="bs-empty">
    <i class="pi pi-inbox text-3xl mb-2 block"></i>
    <p>No jobs yet. New requests will appear here.</p>
  </div>
  <div v-else>
    <!-- Status filter chips. Horizontal scroll on narrow screens so the
         full row stays reachable without wrapping. -->
    <div class="bs-filter-row" role="tablist" aria-label="Filter jobs by status">
      <button
        v-for="opt in chipOptions"
        :key="opt.value"
        type="button"
        role="tab"
        :aria-selected="filter === opt.value"
        class="bs-chip"
        :class="{ 'bs-chip--active': filter === opt.value }"
        :style="filter === opt.value ? { borderColor: opt.color, color: opt.color } : {}"
        @click="filter = opt.value"
      >
        <span
          class="bs-chip-dot"
          :style="{ background: opt.color }"
          aria-hidden="true"
        ></span>
        {{ opt.label }}
        <span class="bs-chip-count">{{ opt.count }}</span>
      </button>
    </div>

    <div
      v-if="totalCount === 0"
      class="bs-empty mt-4"
    >
      <i class="pi pi-inbox text-3xl mb-2 block"></i>
      <p v-if="props.showArchived">No archived jobs yet.</p>
      <p v-else>No active jobs. Archived jobs appear under the archive view.</p>
    </div>

    <div v-else class="space-y-5 mt-4">
      <section v-for="s in visibleSections" :key="s.key">
        <header class="mb-2 flex items-center gap-2">
          <span
            class="h-2.5 w-2.5 rounded-full"
            :style="{ background: SECTION_COLOR[s.key] }"
          ></span>
          <h2 class="text-sm font-semibold">
            {{ SECTION_LABEL[s.key][props.viewerRole] }}
          </h2>
          <span class="text-xs text-[color:var(--bs-muted)]">{{ s.jobs.length }}</span>
        </header>
        <ul class="space-y-2">
          <li
            v-for="job in s.jobs"
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
                <div class="mt-0.5 text-xs text-[color:var(--bs-muted)]">
                  {{ tradeLabel(job.trade) }}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <Tag
                  :value="STATUS_LABEL[job.status]"
                  :severity="STATUS_SEVERITY[job.status]"
                />
                <Tag
                  v-if="job.urgency !== 'flexible'"
                  :value="urgencyLabel(job.urgency)"
                  :severity="urgencyTone[job.urgency] ?? 'info'"
                />
              </div>
            </div>
            <div class="mt-2 flex items-center justify-between gap-2">
              <JobCounterparty
                :role="props.viewerRole === 'client' ? 'tradesperson' : 'client'"
                size="small"
                :name="counterpartyName(job)"
                :photo-url="counterpartyPhoto(job)"
              />
              <div class="flex shrink-0 items-center gap-2 text-xs text-[color:var(--bs-muted)]">
                <span v-if="job.scheduledStart" class="text-[color:var(--bs-blue)]">
                  <i class="pi pi-calendar text-[10px]"></i>
                  {{ dateTime(job.scheduledStart) }}
                </span>
                <span v-else>{{ relativeTime(job.createdAt) }}</span>
                <Button
                  v-if="ARCHIVABLE.has(job.status) || isArchived(job)"
                  :icon="isArchived(job) ? 'pi pi-replay' : 'pi pi-inbox'"
                  :aria-label="isArchived(job) ? 'Restore job' : 'Archive job'"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  @click.stop="toggleArchive(job)"
                />
              </div>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.bs-filter-row {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
  scrollbar-width: thin;
  margin: 0 -0.25rem 0.25rem;
  padding-left: 0.25rem;
  padding-right: 0.25rem;
}
.bs-filter-row::-webkit-scrollbar {
  height: 4px;
}

.bs-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--bs-border);
  background: white;
  color: var(--bs-text);
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
  min-height: 36px;
}
.bs-chip:hover {
  border-color: var(--bs-text);
}
.bs-chip--active {
  font-weight: 600;
}
.bs-chip:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: 2px;
}

.bs-chip-dot {
  height: 0.5rem;
  width: 0.5rem;
  border-radius: 999px;
  flex-shrink: 0;
}

.bs-chip-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  padding: 0 0.35rem;
  height: 1.25rem;
  border-radius: 999px;
  background: var(--bs-surface-alt);
  color: var(--bs-muted);
  font-size: 0.7rem;
  font-weight: 600;
}
.bs-chip--active .bs-chip-count {
  background: color-mix(in srgb, currentColor 12%, white);
  color: currentColor;
}
</style>
