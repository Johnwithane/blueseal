<script setup lang="ts">
// Per-job action menu for the tradesperson jobs list (issue #21).
//
// This replaces a passive status chip. The chip told you "Quote needed" and
// then made you open the job to do anything about it; the ask was to make it
// actionable without losing the status readout — so the status IS the trigger,
// with a chevron.
//
// Items are derived from the job status machine rather than listed flat, so an
// action that can't happen never appears (you can't invoice a cancelled job).
// Everything here is a navigation into the job's own surfaces except Cancel,
// which is the one real mutation and gets a reason dialog.
import { computed, useTemplateRef } from "vue";
import Menu from "primevue/menu";
import Tag from "primevue/tag";
import type { MenuItem } from "primevue/menuitem";
import type { JobDoc, JobStatus, WithId } from "@/firebase/interfaces";
import { statusLabel, STATUS_SEVERITY } from "@/utils/jobStatus";
import { canTradieFinishJob, INSTANT_CANCEL_STATUSES } from "@/firebase/services/jobs";

const props = defineProps<{
  job: WithId<JobDoc>;
}>();

const emit = defineEmits<{
  /** Navigate into the job, optionally deep-linking a tab. */
  open: [payload: { jobId: string; tab?: string }];
  /** Open the wrap-up sheet for this job (confirmed by the caller). */
  finish: [jobId: string];
  /** Open the cancel-with-reason dialog for this job. */
  cancel: [jobId: string];
}>();

const menu = useTemplateRef<InstanceType<typeof Menu>>("menu");

// Nothing is actionable once a job is done or dead — the menu still opens so
// the status stays tappable, but it offers only "Open job".
const TERMINAL: ReadonlySet<JobStatus> = new Set(["complete", "reviewed", "cancelled"]);

// Quoting is only the live question before the client has acted on one.
const QUOTABLE: ReadonlySet<JobStatus> = new Set(["requested", "quoted"]);

const label = computed(() => statusLabel(props.job.status, "tradesperson"));
const severity = computed(() => STATUS_SEVERITY[props.job.status]);

const items = computed<MenuItem[]>(() => {
  const s = props.job.status;
  const terminal = TERMINAL.has(s);
  const out: MenuItem[] = [
    {
      label: "Open job",
      icon: "pi pi-arrow-up-right",
      command: () => emit("open", { jobId: props.job.id }),
    },
  ];
  if (terminal) return out;

  if (QUOTABLE.has(s)) {
    out.push({
      label: s === "quoted" ? "Revise quote" : "Quote",
      icon: "pi pi-file-edit",
      command: () => emit("open", { jobId: props.job.id, tab: "quote" }),
    });
  }
  out.push(
    {
      label: "Schedule",
      icon: "pi pi-calendar",
      command: () => emit("open", { jobId: props.job.id, tab: "schedule" }),
    },
    {
      label: "Invoice",
      icon: "pi pi-receipt",
      command: () => emit("open", { jobId: props.job.id, tab: "invoice" }),
    },
  );

  // A running job can always be finished; a solo job (no client attached) can
  // be closed out from any live status — submitJobForApproval accepts both
  // (#28) and rejects everything else.
  if (canTradieFinishJob(props.job)) {
    out.push({ separator: true }, {
      label: "Complete job",
      icon: "pi pi-check-circle",
      command: () => emit("finish", props.job.id),
    });
  }

  // Pre-commitment only, mirroring the client's rule: nothing is agreed and no
  // money has moved, so either side can walk away instantly. Past that point
  // cancelling is a request the other party accepts — and there is no
  // tradesperson-side equivalent of requestJobChange (it's client-only), so
  // the action correctly isn't offered rather than failing at the callable.
  if ((INSTANT_CANCEL_STATUSES as readonly string[]).includes(s)) {
    out.push({
      label: "Cancel job",
      icon: "pi pi-ban",
      class: "job-action-menu__danger",
      command: () => emit("cancel", props.job.id),
    });
  }
  return out;
});
</script>

<template>
  <div class="shrink-0">
    <button
      type="button"
      class="job-action-menu__trigger"
      :aria-label="`${label} — job actions`"
      aria-haspopup="true"
      @click.stop="menu?.toggle($event)"
    >
      <Tag :value="label" :severity="severity" />
      <i class="pi pi-chevron-down job-action-menu__caret" aria-hidden="true"></i>
    </button>
    <Menu ref="menu" :model="items" popup :pt="{ root: { class: 'job-action-menu__panel' } }" />
  </div>
</template>

<style scoped>
/* The status tag IS the trigger — the chevron is the only added chrome, so the
   list reads the same as before at a glance. 44px min target for thumbs. */
.job-action-menu__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem;
  margin: -0.25rem;
  min-height: 44px;
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 0.5rem;
}
.job-action-menu__trigger:hover,
.job-action-menu__trigger:focus-visible {
  background: var(--bs-surface-alt);
}
.job-action-menu__caret {
  font-size: 0.6rem;
  color: var(--bs-muted);
}
</style>

<style>
/* Unscoped: the popup teleports out of this component's DOM. */
.job-action-menu__panel .job-action-menu__danger .p-menu-item-link,
.job-action-menu__panel .job-action-menu__danger .p-menu-item-icon {
  color: var(--bs-danger);
}
</style>
