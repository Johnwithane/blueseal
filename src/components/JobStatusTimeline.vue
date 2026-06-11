<script setup lang="ts">
// 1. Imports: vue → @ aliases
import { computed } from "vue";
import { JOB_TIMELINE_STEPS, timelineStepIndex } from "@/utils/jobTimeline";
import type { JobStatus } from "@/firebase/interfaces";

// Compact Uber-style progress stepper: five fixed milestones, the exact
// status stays on the existing Tag. Renders nothing for cancelled jobs.
const props = defineProps<{
  status: JobStatus;
  statusBeforeHold?: JobStatus | null;
}>();

const current = computed(() => timelineStepIndex(props.status, props.statusBeforeHold));
const isOnHold = computed(() => props.status === "on_hold");

function stepState(i: number): "done" | "current" | "upcoming" {
  if (current.value === null) return "upcoming";
  if (i < current.value) return "done";
  if (i === current.value) return "current";
  return "upcoming";
}
</script>

<template>
  <ol
    v-if="current !== null"
    class="bs-job-timeline"
    :class="{ 'bs-job-timeline--hold': isOnHold }"
    aria-label="Job progress"
  >
    <li
      v-for="(step, i) in JOB_TIMELINE_STEPS"
      :key="step.key"
      class="bs-job-timeline__step"
      :class="`bs-job-timeline__step--${stepState(i)}`"
      :aria-current="stepState(i) === 'current' ? 'step' : undefined"
    >
      <span class="bs-job-timeline__dot">
        <i v-if="stepState(i) === 'done'" class="pi pi-check" aria-hidden="true"></i>
        <i v-else-if="stepState(i) === 'current' && isOnHold" class="pi pi-pause" aria-hidden="true"></i>
      </span>
      <span class="bs-job-timeline__label">{{ step.label }}</span>
    </li>
  </ol>
</template>

<style scoped>
.bs-job-timeline {
  display: flex;
  align-items: flex-start;
  padding: 0;
  margin: 0;
  list-style: none;
}
.bs-job-timeline__step {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}
/* Connector line: drawn from each step (except the first) back to the
   previous dot, so the row needs no absolute-width math at 375px. */
.bs-job-timeline__step + .bs-job-timeline__step::before {
  content: "";
  position: absolute;
  top: 0.5625rem;
  right: 50%;
  width: 100%;
  height: 2px;
  background: var(--bs-border);
  z-index: 0;
}
.bs-job-timeline__step--done + .bs-job-timeline__step::before,
.bs-job-timeline__step--done + .bs-job-timeline__step--current::before {
  background: var(--bs-blue);
}
.bs-job-timeline__dot {
  position: relative;
  z-index: 1;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.5rem;
  border: 2px solid var(--bs-border);
  background: var(--bs-surface, #fff);
  color: white;
}
.bs-job-timeline__step--done .bs-job-timeline__dot {
  background: var(--bs-blue);
  border-color: var(--bs-blue);
}
.bs-job-timeline__step--current .bs-job-timeline__dot {
  border-color: var(--bs-blue);
  background: var(--bs-blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bs-blue) 25%, transparent);
}
.bs-job-timeline--hold .bs-job-timeline__step--current .bs-job-timeline__dot {
  background: var(--bs-warning);
  border-color: var(--bs-warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bs-warning) 25%, transparent);
}
.bs-job-timeline__label {
  font-size: 0.625rem;
  line-height: 1.1;
  text-align: center;
  color: var(--bs-muted);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bs-job-timeline__step--current .bs-job-timeline__label {
  color: var(--bs-text, inherit);
  font-weight: 600;
}
</style>
