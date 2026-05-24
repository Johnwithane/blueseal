<script setup lang="ts">
import { computed } from "vue";
import type { JobStatus } from "@/firebase/interfaces";
import { PHASES, PHASE_LABEL, phaseForStatus, type Phase } from "@/utils/jobStatus";

const props = defineProps<{
  status: JobStatus;
  cancelledReason?: string | null;
}>();

const currentPhase = computed(() => phaseForStatus(props.status));

const isCancelled = computed(() => currentPhase.value === "cancelled");

// Index of the active phase in PHASES — drives which dots are filled.
// -1 when cancelled (the strip is replaced wholesale in that branch).
const activeIndex = computed(() =>
  isCancelled.value ? -1 : PHASES.indexOf(currentPhase.value as Phase),
);

function dotState(i: number): "past" | "current" | "future" {
  if (i < activeIndex.value) return "past";
  if (i === activeIndex.value) return "current";
  return "future";
}
</script>

<template>
  <div class="bs-phase-strip">
    <div
      v-if="isCancelled"
      class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex items-center gap-2 text-red-800"
    >
      <i class="pi pi-ban text-red-600"></i>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold">Cancelled</div>
        <div v-if="cancelledReason" class="text-xs opacity-80 truncate">
          {{ cancelledReason }}
        </div>
      </div>
    </div>

    <ol v-else class="phase-list" :aria-label="`Job progress: ${PHASE_LABEL[currentPhase as Phase]}`">
      <li
        v-for="(phase, i) in PHASES"
        :key="phase"
        class="phase-item"
        :class="`phase-${dotState(i)}`"
        :aria-current="dotState(i) === 'current' ? 'step' : undefined"
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="label">{{ PHASE_LABEL[phase] }}</span>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.bs-phase-strip {
  margin-bottom: 0.75rem;
}

.phase-list {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0;
  list-style: none;
  padding: 0;
  margin: 0;
  position: relative;
}

/* Connecting line that runs through the centre of all dots. Sits behind
   them via z-indexing so coloured dots punch through the line. */
.phase-list::before {
  content: "";
  position: absolute;
  top: 0.4rem;
  left: 8.333%; /* center of first cell (100% / 6 / 2) */
  right: 8.333%;
  height: 2px;
  background: var(--bs-border);
  z-index: 0;
}

.phase-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  position: relative;
  z-index: 1;
}

.dot {
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 9999px;
  background: white;
  border: 2px solid var(--bs-border);
  flex-shrink: 0;
}

.label {
  font-size: 0.625rem;
  line-height: 1.2;
  color: var(--bs-muted);
  text-align: center;
  letter-spacing: -0.01em;
  /* Allow labels to wrap onto two lines on the tightest mobile widths
     rather than overflowing the dot's cell. */
  word-break: break-word;
}

.phase-past .dot {
  background: var(--bs-blue-light);
  border-color: var(--bs-blue-light);
}
.phase-past .label {
  color: var(--bs-text);
}

.phase-current .dot {
  background: var(--bs-blue);
  border-color: var(--bs-blue);
  width: 1.1rem;
  height: 1.1rem;
  box-shadow: 0 0 0 4px rgba(73, 161, 211, 0.18);
}
.phase-current .label {
  color: var(--bs-blue-dark);
  font-weight: 600;
}

@media (min-width: 640px) {
  .label {
    font-size: 0.75rem;
  }
}
</style>
