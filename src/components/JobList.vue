<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import Tag from "primevue/tag";
import Button from "primevue/button";
import type { JobDoc, JobStatus, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { useActiveClock } from "@/composables/useActiveClock";
import { clockIn, clockOut, formatElapsed } from "@/firebase/services/timeEntries";
import { humanizeError } from "@/utils/errors";
import { statusLabel, STATUS_SEVERITY } from "@/utils/jobStatus";
import { tradeLabel } from "@/data/trades";
import JobCounterparty from "@/components/JobCounterparty.vue";

const props = withDefaults(
  defineProps<{
    jobs: WithId<JobDoc>[];
    /**
     * Which side of the job the viewer is on. Drives which counterparty
     * is rendered (client view shows the tradesperson, tradesperson view
     * shows the client) and which side's labels are used.
     */
    viewerRole: "client" | "tradesperson";
    /**
     * When true, only terminal-status jobs (complete / reviewed /
     * cancelled) are shown — the dashboard's "View completed" view.
     * Defaults to the active list.
     */
    showCompleted?: boolean;
  }>(),
  { showCompleted: false },
);

const router = useRouter();
const { relativeTime, dateTime } = useFormatters();
const toast = useToast();

// The tradie's single live clock session across all jobs — lets a card show
// "Stop · 00:12:34" on the job they're clocked into and "Clock in" elsewhere.
// (No-op for client-only viewers; the composable only listens for tradies.)
const { activeEntry, elapsedMs, isRunningOn } = useActiveClock();
const clockBusy = ref<Set<string>>(new Set());

function setClockBusy(jobId: string, busy: boolean) {
  const next = new Set(clockBusy.value);
  if (busy) next.add(jobId);
  else next.delete(jobId);
  clockBusy.value = next;
}

async function onQuickClockIn(job: WithId<JobDoc>) {
  if (clockBusy.value.has(job.id)) return;
  setClockBusy(job.id, true);
  try {
    await clockIn(job.id);
    toast.success("Clocked in");
  } catch (e) {
    toast.error("Couldn't clock in", humanizeError(e));
  } finally {
    setClockBusy(job.id, false);
  }
}

async function onQuickClockOut(job: WithId<JobDoc>) {
  const entry = activeEntry.value;
  if (!entry || entry.jobId !== job.id || clockBusy.value.has(job.id)) return;
  setClockBusy(job.id, true);
  try {
    await clockOut(job.id, entry.id);
    toast.success("Clocked out");
  } catch (e) {
    toast.error("Couldn't clock out", humanizeError(e));
  } finally {
    setClockBusy(job.id, false);
  }
}

// All statuses worth surfacing on the dashboard, in pipeline order.
// Terminal statuses are partitioned into the "View completed" view
// automatically (see TERMINAL below) so the active list only carries
// live work.
const STATUSES: JobStatus[] = [
  "requested",
  "accepted",
  "quoted",
  "awaiting_upfront_payment",
  "in_progress",
  "on_hold",
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
  on_hold: { client: "On hold", tradesperson: "On hold" },
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
  on_hold: "var(--bs-status-on_hold)",
  awaiting_client_approval: "var(--bs-status-awaiting_client_approval)",
  awaiting_payment: "var(--bs-status-awaiting_payment)",
  complete: "var(--bs-status-complete)",
  reviewed: "var(--bs-status-reviewed)",
  cancelled: "var(--bs-status-cancelled)",
};

const filter = ref<"all" | JobStatus>("all");

// Terminal statuses live in the "View completed" view; everything else
// is active. Filing is automatic — driven purely by job status.
const TERMINAL: ReadonlySet<JobStatus> = new Set(["complete", "reviewed", "cancelled"]);
const partitioned = computed(() =>
  props.jobs.filter((j) => TERMINAL.has(j.status) === props.showCompleted),
);

// Counts per status from the partitioned set so chip badges track the
// current view (e.g. the completed view shows counts of finished jobs).
const counts = computed(() => {
  const m: Record<JobStatus, number> = {
    requested: 0,
    accepted: 0,
    quoted: 0,
    awaiting_upfront_payment: 0,
    in_progress: 0,
    on_hold: 0,
    awaiting_client_approval: 0,
    awaiting_payment: 0,
    complete: 0,
    reviewed: 0,
    cancelled: 0,
  };
  for (const j of partitioned.value) m[j.status] += 1;
  return m;
});

const totalCount = computed(() => partitioned.value.length);

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
    const matching = partitioned.value.filter((j) => j.status === s);
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

function openJob(id: string) {
  router.push({ name: "JobDetail", params: { id } });
}

// Surface an outstanding cancel/hold request on the card so it's visible from
// the Jobs tab without opening the job. The tradesperson is the one who must
// act ("Respond"); the client just sees their request is in flight ("Pending").
function changeTag(
  job: WithId<JobDoc>,
): { label: string; severity: "danger" | "warn" } | null {
  if (!job.pendingChange) return null;
  return props.viewerRole === "tradesperson"
    ? { label: "Respond", severity: "danger" }
    : { label: "Pending", severity: "warn" };
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
      <p v-if="props.showCompleted">
        No completed jobs yet. Jobs land here automatically when they finish.
      </p>
      <p v-else>No active jobs. Finished jobs appear under View completed.</p>
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
                  v-if="changeTag(job)"
                  :value="changeTag(job)!.label"
                  :severity="changeTag(job)!.severity"
                />
                <Tag
                  :value="statusLabel(job.status, props.viewerRole)"
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
                <template v-if="props.viewerRole === 'tradesperson' && job.status === 'in_progress'">
                  <Button
                    v-if="isRunningOn(job.id)"
                    :label="formatElapsed(elapsedMs)"
                    icon="pi pi-stop-circle"
                    severity="danger"
                    size="small"
                    class="shrink-0 font-mono tabular-nums"
                    :loading="clockBusy.has(job.id)"
                    @click.stop="onQuickClockOut(job)"
                  />
                  <Button
                    v-else
                    label="Clock in"
                    icon="pi pi-play"
                    size="small"
                    outlined
                    class="shrink-0"
                    :loading="clockBusy.has(job.id)"
                    @click.stop="onQuickClockIn(job)"
                  />
                </template>
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
