<script setup lang="ts">
// Drag-and-drop triage board for bug reports. Columns are the BugStatus values;
// drag a card onto a column to set its status, or use the per-card status select
// (the mobile/keyboard fallback — native HTML5 drag doesn't fire on touch).
// Grouping is reactive on report.status, so a card auto-moves the instant its
// status changes anywhere: by drag here, by this select, or by the List view's
// triage select. Both controls emit a single `move` the parent persists.
//
// Mirrors the read-only job KanbanBoard's mobile-first scroll-snap strip, but
// adds the drag/drop + select that triage needs.
import { computed, ref } from "vue";
import Tag from "primevue/tag";
import Select from "primevue/select";
import { useFormatters } from "@/composables/useFormatters";
import type { BugReportDoc, BugSeverity, BugStatus, WithId } from "@/firebase/interfaces";

const props = defineProps<{ reports: WithId<BugReportDoc>[] }>();
const emit = defineEmits<{ move: [id: string, status: BugStatus] }>();

const { relativeTime } = useFormatters();

interface Column {
  key: BugStatus;
  label: string;
  color: string;
}
// Ordered left→right as a bug flows through triage. Accents reuse the shared
// semantic tokens (main.css) so the board reads like the rest of the app.
const columns: Column[] = [
  { key: "open", label: "Open", color: "var(--bs-info)" },
  { key: "triaged", label: "Triaged", color: "var(--bs-amber)" },
  { key: "in_progress", label: "In progress", color: "var(--bs-warning)" },
  { key: "fixed", label: "Fixed", color: "var(--bs-success)" },
  { key: "wontfix", label: "Won't fix", color: "var(--bs-muted)" },
];
const STATUS_OPTIONS = columns.map((c) => ({ label: c.label, value: c.key }));

function sevSeverity(s: BugSeverity): "danger" | "warn" | "info" | "secondary" {
  if (s === "critical") return "danger";
  if (s === "high") return "warn";
  if (s === "medium") return "info";
  return "secondary";
}

const byColumn = computed(() => {
  const m: Record<BugStatus, WithId<BugReportDoc>[]> = {
    open: [],
    triaged: [],
    in_progress: [],
    fixed: [],
    wontfix: [],
  };
  for (const r of props.reports) (m[r.status] ??= []).push(r);
  return m;
});

function changeStatus(id: string, status: BugStatus) {
  emit("move", id, status);
}

// --- Drag and drop (desktop) ----------------------------------------------
const draggingId = ref<string | null>(null);
const dragOverCol = ref<BugStatus | null>(null);

function onDragStart(e: DragEvent, id: string) {
  // Don't hijack a drag that started inside the status select.
  if ((e.target as HTMLElement | null)?.closest(".bug-card__no-drag")) {
    e.preventDefault();
    return;
  }
  draggingId.value = id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }
}
function onDragEnd() {
  draggingId.value = null;
  dragOverCol.value = null;
}
function onDrop(col: BugStatus) {
  const id = draggingId.value;
  draggingId.value = null;
  dragOverCol.value = null;
  if (!id) return;
  const r = props.reports.find((x) => x.id === id);
  if (!r || r.status === col) return;
  emit("move", id, col);
}
</script>

<template>
  <div
    class="kanban-strip flex snap-x snap-mandatory scroll-smooth gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 md:snap-none"
  >
    <section
      v-for="col in columns"
      :key="col.key"
      class="min-h-[60vh] w-[85vw] shrink-0 snap-start rounded-xl p-3 transition-colors sm:w-72 md:w-64"
      :class="
        dragOverCol === col.key
          ? 'bg-[color:var(--bs-blue-light)] ring-2 ring-[color:var(--bs-blue)]'
          : 'bg-[color:var(--bs-surface-alt)]'
      "
      @dragover.prevent="dragOverCol = col.key"
      @drop.prevent="onDrop(col.key)"
    >
      <header class="mb-2 flex items-center justify-between">
        <div class="flex min-w-0 items-center gap-2">
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: col.color }"></span>
          <span class="truncate text-sm font-semibold">{{ col.label }}</span>
        </div>
        <span class="ml-2 shrink-0 text-xs text-[color:var(--bs-muted)]">
          {{ byColumn[col.key].length }}
        </span>
      </header>

      <article
        v-for="r in byColumn[col.key]"
        :key="r.id"
        class="bs-card mb-2 cursor-grab p-3 active:cursor-grabbing"
        :class="{ 'opacity-50': draggingId === r.id }"
        draggable="true"
        @dragstart="onDragStart($event, r.id)"
        @dragend="onDragEnd"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="line-clamp-2 min-w-0 flex-1 text-sm font-medium">{{ r.title }}</div>
          <Tag :severity="sevSeverity(r.severity)" :value="r.severity" class="shrink-0" />
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-1 text-xs text-[color:var(--bs-muted)]">
          <span v-if="r.area" class="bs-pill text-[11px]">{{ r.area }}</span>
          <span class="truncate">{{ r.reporterName }} · {{ relativeTime(r.createdAt) }}</span>
        </div>
        <!-- Touch/keyboard fallback for moving a card without dragging. -->
        <div class="bug-card__no-drag mt-2">
          <Select
            :model-value="r.status"
            :options="STATUS_OPTIONS"
            option-label="label"
            option-value="value"
            size="small"
            class="w-full"
            @update:model-value="changeStatus(r.id, $event)"
          />
        </div>
      </article>

      <p
        v-if="byColumn[col.key].length === 0"
        class="px-1 py-6 text-center text-xs text-[color:var(--bs-muted)]"
      >
        Nothing here.
      </p>
    </section>
  </div>
</template>

<style scoped>
/* Match the job board: bleed past .bs-container padding on phones, and escape
   the centred max-width on desktop so the board fills the main column. */
.kanban-strip {
  margin-inline: -1rem;
}
@media (min-width: 768px) {
  .kanban-strip {
    margin-inline: calc(
      -1rem - max(0px, (100vw - var(--bs-content-left-offset, 0px) - 1200px) / 2)
    );
  }
}
</style>
