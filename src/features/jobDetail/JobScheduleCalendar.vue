<script setup lang="ts">
// Per-job calendar for the Schedule tab. Mirrors the dashboard CalendarView's
// week/month grid + navigation, but renders THIS job's booked work sessions as
// pills and swaps the interactions: the tradesperson taps a free day to add a
// session and taps a pill to edit it (no navigation — we're already on the
// job). For the client (canEdit=false) it's a read-only view of the visits.
import { computed, ref } from "vue";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import type { SessionDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  sessions: WithId<SessionDoc>[];
  canEdit: boolean;
}>();
const emit = defineEmits<{
  "add-day": [day: Date];
  "edit-session": [session: WithId<SessionDoc>];
}>();

const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const view = ref<"week" | "month">("week");
const viewOptions = [
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
];

// Anchor = any date inside the week/month we're looking at, at local midnight.
const anchor = ref(startOfDay(new Date()));

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
// Monday-anchored week, matching the rest of the app.
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const today = computed(() => startOfDay(new Date()));
const weekStart = computed(() => startOfWeek(anchor.value));

const timeFmt = new Intl.DateTimeFormat("en-CA", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function sessionLabel(s: WithId<SessionDoc>): string {
  return `${timeFmt.format(s.start.toDate())}–${timeFmt.format(s.end.toDate())}`;
}

// Group sessions by their start day so both views index in O(1).
const sessionsByDateKey = computed(() => {
  const map = new Map<string, WithId<SessionDoc>[]>();
  for (const s of props.sessions) {
    const key = startOfDay(s.start.toDate()).toISOString().slice(0, 10);
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  return map;
});
function dateKey(d: Date): string {
  return startOfDay(d).toISOString().slice(0, 10);
}
function sessionsForDay(d: Date): WithId<SessionDoc>[] {
  return sessionsByDateKey.value.get(dateKey(d)) ?? [];
}

const weekDays = computed(() => {
  const start = weekStart.value;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
});
const monthGrid = computed(() => {
  const first = new Date(anchor.value.getFullYear(), anchor.value.getMonth(), 1);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
});

const headerLabel = computed(() => {
  if (view.value === "month") {
    return `${monthNames[anchor.value.getMonth()]} ${anchor.value.getFullYear()}`;
  }
  const start = weekStart.value;
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const startStr = `${monthNames[start.getMonth()].slice(0, 3)} ${start.getDate()}`;
  const endStr = sameMonth
    ? `${end.getDate()}`
    : `${monthNames[end.getMonth()].slice(0, 3)} ${end.getDate()}`;
  return `${startStr} – ${endStr}, ${end.getFullYear()}`;
});

function shift(direction: -1 | 1) {
  const next = new Date(anchor.value);
  if (view.value === "week") next.setDate(next.getDate() + direction * 7);
  else next.setMonth(next.getMonth() + direction);
  anchor.value = startOfDay(next);
}
function goToday() {
  anchor.value = startOfDay(new Date());
}
function isPast(d: Date): boolean {
  return startOfDay(d).getTime() < today.value.getTime();
}
// A day can take a new session if editable and not in the past. Past days
// still show their pills (and stay editable via the pill) — you just can't
// book new work into a day that's already gone.
function canAdd(d: Date, inCurrentMonth = true): boolean {
  return props.canEdit && inCurrentMonth && !isPast(d);
}
</script>

<template>
  <div>
    <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <Button
          icon="pi pi-chevron-left"
          severity="secondary"
          outlined
          size="small"
          :aria-label="view === 'week' ? 'Previous week' : 'Previous month'"
          @click="shift(-1)"
        />
        <Button label="Today" severity="secondary" outlined size="small" @click="goToday" />
        <Button
          icon="pi pi-chevron-right"
          severity="secondary"
          outlined
          size="small"
          :aria-label="view === 'week' ? 'Next week' : 'Next month'"
          @click="shift(1)"
        />
        <h2 class="ml-2 text-base font-semibold">{{ headerLabel }}</h2>
      </div>
      <SelectButton
        v-model="view"
        :options="viewOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
      />
    </header>

    <!-- WEEK VIEW -->
    <div v-if="view === 'week'" class="grid grid-cols-1 gap-2 sm:grid-cols-7">
      <div
        v-for="(d, i) in weekDays"
        :key="d.toISOString()"
        class="bs-card min-h-[7rem] sm:min-h-[16rem] p-3"
        :class="{ 'ring-2 ring-[color:var(--bs-blue)]': isSameDay(d, today) }"
      >
        <header class="mb-2 flex items-center justify-between">
          <div class="font-semibold text-sm">
            {{ dayLabels[i] }}
            <span class="ml-1 text-[color:var(--bs-muted)] font-normal">{{ d.getDate() }}</span>
          </div>
        </header>
        <component
          :is="canEdit ? 'button' : 'div'"
          v-for="s in sessionsForDay(d)"
          :key="s.id"
          type="button"
          class="mb-1 block w-full rounded-md bg-[color:var(--bs-blue)] p-2 text-left text-xs text-white"
          :class="canEdit ? 'cursor-pointer hover:opacity-90' : ''"
          @click="canEdit && emit('edit-session', s)"
        >
          <div class="font-medium">{{ sessionLabel(s) }}</div>
          <div v-if="s.note" class="line-clamp-2 opacity-80">{{ s.note }}</div>
        </component>
        <button
          v-if="canAdd(d)"
          type="button"
          class="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-[color:var(--bs-border)] py-1 text-xs text-[color:var(--bs-muted)] hover:border-[color:var(--bs-blue)] hover:bg-blue-50 hover:text-[color:var(--bs-blue)]"
          @click="emit('add-day', d)"
        >
          <i class="pi pi-plus text-[10px]"></i>
          Add session
        </button>
      </div>
    </div>

    <!-- MONTH VIEW -->
    <div v-else>
      <div class="mb-1 hidden grid-cols-7 gap-2 sm:grid">
        <div
          v-for="label in dayLabels"
          :key="label"
          class="text-center text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)]"
        >
          {{ label }}
        </div>
      </div>
      <div class="grid grid-cols-7 gap-1 sm:gap-2">
        <div
          v-for="d in monthGrid"
          :key="d.toISOString()"
          class="bs-card flex min-h-[5rem] flex-col p-1.5 sm:min-h-[7rem] sm:p-2"
          :class="{
            'opacity-50': d.getMonth() !== anchor.getMonth(),
            'ring-2 ring-[color:var(--bs-blue)]': isSameDay(d, today),
            'cursor-pointer hover:bg-blue-50/40': canAdd(d, d.getMonth() === anchor.getMonth()),
          }"
          :role="canAdd(d, d.getMonth() === anchor.getMonth()) ? 'button' : undefined"
          :aria-label="
            canAdd(d, d.getMonth() === anchor.getMonth()) ? `Add session ${d.toDateString()}` : undefined
          "
          @click="canAdd(d, d.getMonth() === anchor.getMonth()) && emit('add-day', d)"
        >
          <div class="mb-1 text-xs font-semibold sm:text-sm">{{ d.getDate() }}</div>
          <article
            v-for="s in sessionsForDay(d).slice(0, 2)"
            :key="s.id"
            class="mb-0.5 truncate rounded bg-[color:var(--bs-blue)] px-1.5 py-0.5 text-[10px] text-white sm:text-xs"
            :class="canEdit ? 'cursor-pointer' : ''"
            @click.stop="canEdit && emit('edit-session', s)"
          >
            {{ sessionLabel(s) }}
          </article>
          <div
            v-if="sessionsForDay(d).length > 2"
            class="text-[10px] text-[color:var(--bs-muted)] sm:text-xs"
          >
            +{{ sessionsForDay(d).length - 2 }} more
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
