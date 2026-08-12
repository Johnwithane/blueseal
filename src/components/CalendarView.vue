<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import Dialog from "primevue/dialog";
import JobCounterparty from "@/components/JobCounterparty.vue";
import type { BookingDoc, JobDoc, WeeklyAvailability, WithId } from "@/firebase/interfaces";

const props = withDefaults(
  defineProps<{
    jobs: WithId<JobDoc>[];
    availability: WeeklyAvailability;
    blocks?: WithId<BookingDoc>[];
    /**
     * Whether the viewer may change this calendar. Only the tradesperson
     * viewing their OWN calendar (dashboard, or their own public profile) may
     * block / unblock days — clients, admins and the public see it read-only.
     * Defaults to read-only so a new mount can't leak the block controls by
     * forgetting the prop.
     */
    isEditable?: boolean;
  }>(),
  { blocks: () => [], isEditable: false },
);
const emit = defineEmits<{
  "remove-block": [bookingId: string];
  "block-day": [day: Date];
}>();
const router = useRouter();

const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Month first: a tradesperson planning work wants the shape of the whole month
// at a glance, then drills into a day. Week stays one tap away.
const view = ref<"week" | "month">("month");
const viewOptions = [
  { label: "Month", value: "month" },
  { label: "Week", value: "week" },
];

// Anchor controls "which window are we looking at?" — for week view it's
// any date inside the target week, for month view it's any date inside
// the target month. Always at midnight local time.
const anchor = ref(startOfDay(new Date()));

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Monday-anchored week (matches the rest of the app's Mon→Sun order).
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

// Local (not UTC) date key — toISOString() would shift a job into the previous
// day for anyone west of Greenwich, which is every Canadian timezone.
function dateKey(d: Date): string {
  const x = startOfDay(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
    x.getDate(),
  ).padStart(2, "0")}`;
}

// Group scheduled jobs by ISO date key so both views can index in O(1). A job
// spanning several days is indexed under EVERY day it covers — a two-day
// install should show on both days, not just the one it started on.
const jobsByDateKey = computed(() => {
  const map = new Map<string, WithId<JobDoc>[]>();
  for (const job of props.jobs) {
    if (!job.scheduledStart) continue;
    const first = startOfDay(job.scheduledStart.toDate());
    const last = job.scheduledEnd ? startOfDay(job.scheduledEnd.toDate()) : first;
    // Guard against a bad end-before-start and runaway ranges.
    const cursor = new Date(first);
    for (let i = 0; i < 90 && cursor.getTime() <= last.getTime(); i++) {
      const key = dateKey(cursor);
      const list = map.get(key) ?? [];
      list.push(job);
      map.set(key, list);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return map;
});

function jobsForDay(d: Date): WithId<JobDoc>[] {
  return jobsByDateKey.value.get(dateKey(d)) ?? [];
}

// Blocks are stored as [start, end) ranges. A day is "blocked" if it falls
// inside any block — we check by day-of-year overlap rather than precise
// timestamp so a multi-day vacation block highlights every covered cell.
function blocksForDay(d: Date): WithId<BookingDoc>[] {
  const dayStart = startOfDay(d).getTime();
  const dayEnd = dayStart + 86_400_000;
  return (props.blocks ?? []).filter((b) => {
    if (b.type !== "blocked") return false;
    const s = b.start.toDate().getTime();
    const e = b.end.toDate().getTime();
    return s < dayEnd && e > dayStart;
  });
}

// Week view: 7 consecutive days from weekStart.
const weekDays = computed(() => {
  const start = weekStart.value;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
});

// Month view: a 6×7 grid that starts on the Monday on/before the first of
// the month and runs forward 42 days. Days outside the current month are
// rendered dimmed for context — Google-Calendar style.
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
  if (view.value === "week") {
    next.setDate(next.getDate() + direction * 7);
  } else {
    next.setMonth(next.getMonth() + direction);
  }
  anchor.value = startOfDay(next);
}

function goToday() {
  anchor.value = startOfDay(new Date());
}

function dayOfWeekKey(d: Date): (typeof days)[number] {
  return days[(d.getDay() + 6) % 7];
}

// A day is "blockable" if it's today or later AND not already blocked.
// We also skip days outside the visible month in month view — blocking a
// Feb day from a March view would be confusing.
function isPast(d: Date): boolean {
  return startOfDay(d).getTime() < today.value.getTime();
}
function canBlock(d: Date, inCurrentMonth = true): boolean {
  // Read-only viewers (clients, admins, public) never get the block affordance.
  if (!props.isEditable) return false;
  if (!inCurrentMonth) return false;
  if (isPast(d)) return false;
  if (blocksForDay(d).length > 0) return false;
  return true;
}

const pendingBlockDate = ref<Date | null>(null);
const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const pendingBlockLabel = computed(() =>
  pendingBlockDate.value ? dayFmt.format(pendingBlockDate.value) : "",
);
function askBlock(d: Date) {
  pendingBlockDate.value = startOfDay(d);
}
function confirmBlock() {
  if (pendingBlockDate.value) emit("block-day", pendingBlockDate.value);
  pendingBlockDate.value = null;
  openDay.value = null; // the day sheet's answer to "block this?" is now given
}

// --- Day detail --------------------------------------------------------------
// Tapping a day opens an hour-by-hour view of it (Outlook-style): the working
// window down the side, each scheduled job drawn against the hours it actually
// occupies. This is where blocking now lives too — a tap used to block the day
// outright, which is a surprising thing for a tap to do once days carry work.

const openDay = ref<Date | null>(null);
const openDayLabel = computed(() => (openDay.value ? dayFmt.format(openDay.value) : ""));
const openDayJobs = computed(() =>
  openDay.value
    ? [...jobsForDay(openDay.value)].sort(
        (a, b) => (a.scheduledStart?.toMillis() ?? 0) - (b.scheduledStart?.toMillis() ?? 0),
      )
    : [],
);
const openDayBlocks = computed(() => (openDay.value ? blocksForDay(openDay.value) : []));
const openDayAvailability = computed(() =>
  openDay.value ? props.availability[dayOfWeekKey(openDay.value)] : [],
);

function openDayDetail(d: Date) {
  openDay.value = startOfDay(d);
}

const HOUR_PX = 44;

/** Minutes from midnight, clamped into the open day (multi-day jobs included). */
function minutesInOpenDay(ts: Date, fallback: number): number {
  if (!openDay.value) return fallback;
  const dayStart = openDay.value.getTime();
  const offset = (ts.getTime() - dayStart) / 60_000;
  return Math.min(1440, Math.max(0, offset));
}

interface DayEntry {
  job: WithId<JobDoc>;
  startMin: number;
  endMin: number;
  timeLabel: string;
  lane: number;
  lanes: number;
}

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Jobs placed on the hour rail. Anything without a scheduledEnd gets a nominal
// one-hour block so it's still visible and clickable.
const dayEntries = computed<DayEntry[]>(() => {
  const raw = openDayJobs.value.map((job) => {
    const startMin = job.scheduledStart ? minutesInOpenDay(job.scheduledStart.toDate(), 0) : 0;
    const endMin = job.scheduledEnd
      ? Math.max(startMin + 30, minutesInOpenDay(job.scheduledEnd.toDate(), startMin + 60))
      : startMin + 60;
    return {
      job,
      startMin,
      endMin,
      timeLabel: `${hhmm(startMin)} – ${hhmm(endMin)}`,
      lane: 0,
      lanes: 1,
    };
  });
  // Side-by-side lanes for overlapping jobs, so a double-booking is visible as
  // two blocks rather than one hidden behind the other.
  const laneEnds: number[] = [];
  for (const e of raw) {
    let lane = laneEnds.findIndex((end) => end <= e.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e.endMin);
    } else {
      laneEnds[lane] = e.endMin;
    }
    e.lane = lane;
  }
  const lanes = Math.max(1, laneEnds.length);
  for (const e of raw) e.lanes = lanes;
  return raw;
});

// The hour window the rail renders: wide enough for the working hours AND any
// job that runs outside them, with an hour of breathing room either side.
const dayWindow = computed(() => {
  let from = 8;
  let to = 18;
  for (const b of openDayAvailability.value) {
    from = Math.min(from, Number(b.start.slice(0, 2)));
    to = Math.max(to, Math.ceil(Number(b.end.slice(0, 2)) + (b.end.slice(3) === "00" ? 0 : 1)));
  }
  for (const e of dayEntries.value) {
    from = Math.min(from, Math.floor(e.startMin / 60));
    to = Math.max(to, Math.ceil(e.endMin / 60));
  }
  return { from: Math.max(0, from - 1), to: Math.min(24, to + 1) };
});
const dayHours = computed(() =>
  Array.from(
    { length: dayWindow.value.to - dayWindow.value.from },
    (_, i) => dayWindow.value.from + i,
  ),
);
function entryStyle(e: DayEntry) {
  const top = ((e.startMin - dayWindow.value.from * 60) / 60) * HOUR_PX;
  const height = Math.max(24, ((e.endMin - e.startMin) / 60) * HOUR_PX - 2);
  const widthPct = 100 / e.lanes;
  return {
    top: `${top}px`,
    height: `${height}px`,
    left: `calc(${e.lane * widthPct}% + 2px)`,
    width: `calc(${widthPct}% - 4px)`,
  };
}
// Shaded band behind the working hours, so "outside my hours" reads at a glance.
function availabilityStyle(block: { start: string; end: string }) {
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const top = ((toMin(block.start) - dayWindow.value.from * 60) / 60) * HOUR_PX;
  const height = ((toMin(block.end) - toMin(block.start)) / 60) * HOUR_PX;
  return { top: `${top}px`, height: `${height}px` };
}

function openJob(jobId: string) {
  openDay.value = null;
  void router.push({ name: "JobDetail", params: { id: jobId } });
}

// "09:00" for the month-cell chip. Blank on a continuation day of a multi-day
// job — it doesn't start at 09:00 on day two, it's just still running.
function startTimeOn(job: WithId<JobDoc>, d: Date): string {
  if (!job.scheduledStart) return "";
  const start = job.scheduledStart.toDate();
  if (!isSameDay(start, d)) return "";
  return `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
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
    <!-- Mobile: full-width vertical agenda (1 col, compact height) so each day
         is readable; sm+: the 7-across week grid. -->
    <div v-if="view === 'week'" class="grid grid-cols-1 gap-2 sm:grid-cols-7">
      <div
        v-for="(d, i) in weekDays"
        :key="d.toISOString()"
        class="bs-card min-h-[7rem] sm:min-h-[16rem] p-3"
        :class="{ 'ring-2 ring-[color:var(--bs-blue)]': isSameDay(d, today) }"
      >
        <header class="mb-2 flex items-center justify-between">
          <button
            type="button"
            class="font-semibold text-sm hover:text-[color:var(--bs-blue)]"
            :aria-label="`Open ${d.toDateString()}`"
            @click="openDayDetail(d)"
          >
            {{ dayLabels[i] }}
            <span class="ml-1 text-[color:var(--bs-muted)] font-normal">{{ d.getDate() }}</span>
          </button>
          <div class="text-xs text-[color:var(--bs-muted)]">
            {{
              props.availability[dayOfWeekKey(d)].length
                ? `${props.availability[dayOfWeekKey(d)].length} block(s)`
                : "Off"
            }}
          </div>
        </header>
        <div
          v-for="block in props.availability[dayOfWeekKey(d)]"
          :key="block.start + block.end"
          class="mb-1 rounded bg-[color:var(--bs-info-tint)] px-2 py-1 text-xs text-[color:var(--bs-info-text)]"
        >
          {{ block.start }} – {{ block.end }}
        </div>
        <article
          v-for="b in blocksForDay(d)"
          :key="b.id"
          class="mt-1 flex items-center justify-between rounded-md bg-[color:var(--bs-danger-tint)] px-2 py-1 text-xs text-[color:var(--bs-danger-text)]"
        >
          <span class="flex items-center gap-1">
            <i class="pi pi-ban text-[10px]"></i>
            <span>Blocked</span>
          </span>
          <button
            v-if="props.isEditable"
            type="button"
            class="text-[color:var(--bs-danger)] hover:text-[color:var(--bs-danger-text)]"
            aria-label="Remove block"
            @click="emit('remove-block', b.id)"
          >
            <i class="pi pi-times text-[10px]"></i>
          </button>
        </article>
        <article
          v-for="job in jobsForDay(d)"
          :key="job.id"
          class="mt-2 cursor-pointer rounded-md bg-[color:var(--bs-blue)] p-2 text-xs text-white"
          @click="router.push({ name: 'JobDetail', params: { id: job.id } })"
        >
          <div class="line-clamp-1 font-medium">{{ job.title }}</div>
          <div class="line-clamp-1 opacity-80">{{ job.trade }}</div>
          <div class="mt-1.5 text-white">
            <JobCounterparty
              role="client"
              size="small"
              :name="job.clientName"
              :photo-url="job.clientPhotoURL"
            />
          </div>
        </article>
        <button
          v-if="canBlock(d)"
          type="button"
          class="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-[color:var(--bs-border)] py-1 text-xs text-[color:var(--bs-muted)] hover:border-[color:var(--bs-danger)] hover:bg-[color:var(--bs-danger-tint)] hover:text-[color:var(--bs-danger)]"
          @click="askBlock(d)"
        >
          <i class="pi pi-ban text-[10px]"></i>
          Block day
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
        <!-- Tapping a cell opens the day (hours + its jobs). Blocking lives
             inside that sheet now — a bare tap silently blocking the day was
             too destructive for the primary gesture. -->
        <button
          v-for="d in monthGrid"
          :key="d.toISOString()"
          type="button"
          class="bs-card flex min-h-[5rem] flex-col p-1.5 text-left sm:min-h-[7rem] sm:p-2 hover:border-[color:var(--bs-blue)]"
          :class="{
            'opacity-50': d.getMonth() !== anchor.getMonth(),
            'ring-2 ring-[color:var(--bs-blue)]': isSameDay(d, today),
            'bg-[color:var(--bs-danger-tint)]': blocksForDay(d).length > 0,
          }"
          :aria-label="`Open ${d.toDateString()}`"
          @click="openDayDetail(d)"
        >
          <div class="mb-1 flex items-center justify-between">
            <div class="text-xs font-semibold sm:text-sm">{{ d.getDate() }}</div>
            <div class="flex items-center gap-1">
              <i
                v-if="blocksForDay(d).length > 0"
                class="pi pi-ban text-[10px] text-[color:var(--bs-danger)]"
                title="Blocked"
              ></i>
              <span
                v-if="props.availability[dayOfWeekKey(d)].length"
                class="h-1.5 w-1.5 rounded-full bg-[color:var(--bs-blue)]"
                :title="`${props.availability[dayOfWeekKey(d)].length} availability block(s)`"
              ></span>
            </div>
          </div>
          <!-- Chips are labels, not links: the whole cell is the button, and
               nesting a control inside it would be invalid. Open the day, then
               the job. -->
          <span
            v-for="job in jobsForDay(d).slice(0, 2)"
            :key="job.id"
            class="mb-0.5 block truncate rounded bg-[color:var(--bs-blue)] px-1.5 py-0.5 text-[10px] text-white sm:text-xs"
          >
            <span v-if="startTimeOn(job, d)" class="font-semibold">{{ startTimeOn(job, d) }}</span>
            {{ job.title }}
          </span>
          <span
            v-if="jobsForDay(d).length > 2"
            class="text-[10px] text-[color:var(--bs-muted)] sm:text-xs"
          >
            +{{ jobsForDay(d).length - 2 }} more
          </span>
        </button>
      </div>
    </div>

    <!-- DAY DETAIL — hours down the side, jobs drawn against the hours they
         actually occupy, and the day's block controls. -->
    <Dialog
      :visible="openDay !== null"
      modal
      :header="openDayLabel"
      :style="{ width: '94vw', maxWidth: '32rem' }"
      :draggable="false"
      @update:visible="
        (v) => {
          if (!v) openDay = null;
        }
      "
    >
      <div
        v-if="openDayBlocks.length"
        class="mb-3 flex items-center justify-between gap-2 rounded-md bg-[color:var(--bs-danger-tint)] px-3 py-2 text-sm text-[color:var(--bs-danger-text)]"
      >
        <span class="flex items-center gap-2">
          <i class="pi pi-ban text-xs"></i>
          <span>You've blocked this day.</span>
        </span>
        <button
          v-if="props.isEditable"
          type="button"
          class="text-xs underline"
          @click="emit('remove-block', openDayBlocks[0].id)"
        >
          Unblock
        </button>
      </div>

      <p class="mb-2 text-xs text-[color:var(--bs-muted)]">
        <template v-if="openDayAvailability.length">
          Working hours
          <span
            v-for="(b, i) in openDayAvailability"
            :key="b.start + b.end"
            class="font-medium text-[color:var(--bs-text)]"
            >{{ i ? ", " : " " }}{{ b.start }}–{{ b.end }}</span
          >
        </template>
        <template v-else>Not a working day.</template>
      </p>

      <!-- Hour rail. Each row is one hour; job blocks are absolutely placed
           over it so a 09:30–11:00 job reads as an hour and a half. -->
      <div class="flex max-h-[55vh] overflow-y-auto">
        <div class="w-12 shrink-0">
          <div
            v-for="h in dayHours"
            :key="h"
            class="h-[44px] pr-2 text-right text-[10px] text-[color:var(--bs-muted)]"
          >
            {{ String(h).padStart(2, "0") }}:00
          </div>
        </div>
        <div class="relative flex-1 border-l border-[color:var(--bs-border)]">
          <div
            v-for="h in dayHours"
            :key="h"
            class="h-[44px] border-b border-dashed border-[color:var(--bs-border)]"
          ></div>
          <div
            v-for="b in openDayAvailability"
            :key="`av-${b.start}-${b.end}`"
            class="pointer-events-none absolute inset-x-0 bg-[color:var(--bs-info-tint)]"
            :style="availabilityStyle(b)"
          ></div>
          <button
            v-for="e in dayEntries"
            :key="e.job.id"
            type="button"
            class="absolute overflow-hidden rounded-md bg-[color:var(--bs-blue)] px-2 py-1 text-left text-xs text-white"
            :style="entryStyle(e)"
            @click="openJob(e.job.id)"
          >
            <span class="block truncate font-medium">{{ e.job.title }}</span>
            <span class="block truncate opacity-80">{{ e.timeLabel }}</span>
            <span class="block truncate opacity-80">{{ e.job.clientName || e.job.trade }}</span>
          </button>
          <p
            v-if="!dayEntries.length"
            class="absolute inset-0 flex items-center justify-center text-xs text-[color:var(--bs-muted)]"
          >
            Nothing scheduled.
          </p>
        </div>
      </div>

      <template #footer>
        <Button label="Close" severity="secondary" text @click="openDay = null" />
        <Button
          v-if="openDay && canBlock(openDay)"
          label="Block day"
          icon="pi pi-ban"
          severity="danger"
          outlined
          @click="askBlock(openDay)"
        />
      </template>
    </Dialog>

    <Dialog
      :visible="pendingBlockDate !== null"
      modal
      header="Block this day?"
      :style="{ width: '90vw', maxWidth: '22rem' }"
      :draggable="false"
      @update:visible="
        (v) => {
          if (!v) pendingBlockDate = null;
        }
      "
    >
      <p class="text-sm">
        Mark <span class="font-semibold">{{ pendingBlockLabel }}</span> as unavailable? New bookings
        won't land on this day.
      </p>
      <p class="mt-2 text-xs text-[color:var(--bs-muted)]">
        You can unblock it again by opening the day.
      </p>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="pendingBlockDate = null" />
        <Button label="Block day" icon="pi pi-ban" severity="danger" @click="confirmBlock" />
      </template>
    </Dialog>
  </div>
</template>
