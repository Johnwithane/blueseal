<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import Select from "primevue/select";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Message from "primevue/message";
import Dialog from "primevue/dialog";
import JobCounterparty from "@/components/JobCounterparty.vue";
import { STATUS_LABEL } from "@/utils/jobStatus";
import { formatTimeOfDay, parseTimeOfDay } from "@/composables/useFormatters";
import type { SessionWithJob } from "@/firebase/services/sessions";
import type { BookingDoc, JobDoc, WeeklyAvailability, WithId } from "@/firebase/interfaces";

const props = withDefaults(
  defineProps<{
    jobs: WithId<JobDoc>[];
    availability: WeeklyAvailability;
    blocks?: WithId<BookingDoc>[];
    /**
     * Booked visits across the viewer's jobs. When supplied, the calendar draws
     * ONE BLOCK PER VISIT at its real hours instead of one bar per job spanning
     * first-to-last visit — a job with two 3-hour visits should read as two
     * short blocks, not a 3-day bar. Optional so the read-only consumers (public
     * profile, PM calendar) keep their existing job-window rendering.
     */
    sessions?: WithId<SessionWithJob>[];
    /**
     * Live jobs the viewer may book time against, for the day sheet's "Add time
     * to a job" picker. Empty (the default) hides the affordance entirely.
     */
    schedulableJobs?: WithId<JobDoc>[];
    /** Disables the add-time form while the parent is writing. */
    savingSession?: boolean;
    /**
     * Whether the viewer may change this calendar. Only the tradesperson
     * viewing their OWN calendar (dashboard, or their own public profile) may
     * block / unblock days — clients, admins and the public see it read-only.
     * Defaults to read-only so a new mount can't leak the block controls by
     * forgetting the prop.
     */
    isEditable?: boolean;
  }>(),
  {
    blocks: () => [],
    sessions: () => [],
    schedulableJobs: () => [],
    savingSession: false,
    isEditable: false,
  },
);
const emit = defineEmits<{
  "remove-block": [bookingId: string];
  "block-day": [day: Date];
  // Book time against an existing job, straight from the calendar. The parent
  // owns collision detection + the write (it reuses the job page's flow).
  "add-session": [payload: { jobId: string; start: Date; end: Date; note: string }];
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

// One thing drawn on the calendar. Two sources feed it:
//  - a booked VISIT (jobs/{id}/sessions) — the precise "I'm on site 09:00-12:00"
//  - a job's own scheduledStart/End window, for jobs with no visits loaded
// A job's scheduledStart is derived FROM its visits, so a job that has visits is
// skipped here — otherwise it'd draw twice (once as the visit, once as the
// window spanning them all).
interface CalEntry {
  key: string;
  jobId: string;
  title: string;
  trade: string;
  clientName?: string | null;
  clientPhotoURL?: string | null;
  start: Date;
  end: Date | null;
  note: string;
}

const calEntries = computed<CalEntry[]>(() => {
  const jobById = new Map(props.jobs.map((j) => [j.id, j]));
  const out: CalEntry[] = [];
  const jobsWithVisits = new Set<string>();
  for (const s of props.sessions) {
    jobsWithVisits.add(s.jobId);
    const j = jobById.get(s.jobId);
    out.push({
      key: `s-${s.id}`,
      jobId: s.jobId,
      title: j?.title ?? "Booked visit",
      trade: j?.trade ?? "",
      clientName: j?.clientName ?? null,
      clientPhotoURL: j?.clientPhotoURL ?? null,
      start: s.start.toDate(),
      end: s.end.toDate(),
      note: s.note ?? "",
    });
  }
  for (const job of props.jobs) {
    if (!job.scheduledStart || jobsWithVisits.has(job.id)) continue;
    out.push({
      key: `j-${job.id}`,
      jobId: job.id,
      title: job.title,
      trade: job.trade,
      clientName: job.clientName,
      clientPhotoURL: job.clientPhotoURL,
      start: job.scheduledStart.toDate(),
      end: job.scheduledEnd ? job.scheduledEnd.toDate() : null,
      note: "",
    });
  }
  return out;
});

// Index by ISO date key so both views look up in O(1). An entry spanning
// several days is indexed under EVERY day it covers — a two-day install should
// show on both days, not just the one it started on.
const entriesByDateKey = computed(() => {
  const map = new Map<string, CalEntry[]>();
  for (const e of calEntries.value) {
    const first = startOfDay(e.start);
    const last = e.end ? startOfDay(e.end) : first;
    // Guard against a bad end-before-start and runaway ranges.
    const cursor = new Date(first);
    for (let i = 0; i < 90 && cursor.getTime() <= last.getTime(); i++) {
      const key = dateKey(cursor);
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return map;
});

function entriesForDay(d: Date): CalEntry[] {
  return entriesByDateKey.value.get(dateKey(d)) ?? [];
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
const openDayEntries = computed(() =>
  openDay.value
    ? [...entriesForDay(openDay.value)].sort((a, b) => a.start.getTime() - b.start.getTime())
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
  entry: CalEntry;
  startMin: number;
  endMin: number;
  timeLabel: string;
  lane: number;
  lanes: number;
}

// Entries placed on the hour rail. Anything with no end gets a nominal one-hour
// block so it's still visible and clickable.
const dayEntries = computed<DayEntry[]>(() => {
  const raw = openDayEntries.value.map((entry) => {
    const startMin = minutesInOpenDay(entry.start, 0);
    const endMin = entry.end
      ? Math.max(startMin + 30, minutesInOpenDay(entry.end, startMin + 60))
      : startMin + 60;
    return {
      entry,
      startMin,
      endMin,
      // Display-only (issue #17): the minutes behind it are unchanged.
      timeLabel: `${formatTimeOfDay(startMin)} – ${formatTimeOfDay(endMin)}`,
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
// Gutter label for one hour row — compact so "9 a.m." fits the narrow rail.
function hourLabel(h: number): string {
  return formatTimeOfDay(h * 60, { compact: true });
}
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

// --- Book time against an existing job, from the calendar --------------------
// The whole point of the report: rather than opening each job's Schedule tab,
// pick the day here and add the visit. The parent owns collision detection and
// the write, so this is purely the form.
const showAdd = ref(false);
const addJobId = ref<string | null>(null);
// Held as display text (12-hour), parsed back on submit. The availability
// prefill below converts the stored "HH:mm" wire value into the same shape.
const addStart = ref(formatTimeOfDay("09:00"));
const addEnd = ref(formatTimeOfDay("12:00"));
const addNote = ref("");
const addError = ref("");

const jobOptions = computed(() =>
  props.schedulableJobs.map((j) => ({
    value: j.id,
    label: j.title || "Untitled job",
    detail: [STATUS_LABEL[j.status] ?? j.status, j.clientName].filter(Boolean).join(" · "),
  })),
);

function openAddTime() {
  if (!openDay.value) return;
  addJobId.value = props.schedulableJobs[0]?.id ?? null;
  // Default to the start of their working hours for that day, so the common
  // case is "pick the job, tap save".
  const avail = props.availability[dayOfWeekKey(openDay.value)];
  addStart.value = formatTimeOfDay(avail?.[0]?.start ?? "09:00");
  addEnd.value = formatTimeOfDay(avail?.[0]?.end ?? "12:00");
  addNote.value = "";
  addError.value = "";
  showAdd.value = true;
}

// Accepts either shape the field offers — "9:00 a.m." (what it now shows) or
// the "17:00" a tradesperson may still type out of habit.
function timeToDate(day: Date, text: string): Date | null {
  const mins = parseTimeOfDay(text);
  if (mins === null) return null;
  const d = new Date(day);
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d;
}

function submitAddTime() {
  addError.value = "";
  if (!openDay.value || !addJobId.value) {
    addError.value = "Pick a job first.";
    return;
  }
  const start = timeToDate(openDay.value, addStart.value);
  const end = timeToDate(openDay.value, addEnd.value);
  if (!start || !end) {
    addError.value = "Enter times like 9:00 am (24-hour, e.g. 17:00, works too).";
    return;
  }
  if (end <= start) {
    addError.value = "The end time has to be after the start.";
    return;
  }
  emit("add-session", {
    jobId: addJobId.value,
    start,
    end,
    note: addNote.value.trim().slice(0, 500),
  });
  showAdd.value = false;
  openDay.value = null;
}

// "9:00 a.m." for the month-cell chip. Blank on a continuation day of a
// multi-day entry — it doesn't start at 9 on day two, it's just still running.
function startTimeOn(e: CalEntry, d: Date): string {
  if (!isSameDay(e.start, d)) return "";
  return formatTimeOfDay(e.start, { compact: true });
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
          {{ formatTimeOfDay(block.start) }} – {{ formatTimeOfDay(block.end) }}
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
          v-for="e in entriesForDay(d)"
          :key="e.key"
          class="mt-2 cursor-pointer rounded-md bg-[color:var(--bs-blue)] p-2 text-xs text-white"
          @click="router.push({ name: 'JobDetail', params: { id: e.jobId } })"
        >
          <div class="line-clamp-1 font-medium">{{ e.title }}</div>
          <div class="line-clamp-1 opacity-80">
            <span v-if="startTimeOn(e, d)">{{ startTimeOn(e, d) }} · </span>{{ e.trade }}
          </div>
          <div class="mt-1.5 text-white">
            <JobCounterparty
              role="client"
              size="small"
              :name="e.clientName"
              :photo-url="e.clientPhotoURL"
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
            v-for="e in entriesForDay(d).slice(0, 2)"
            :key="e.key"
            class="mb-0.5 block truncate rounded bg-[color:var(--bs-blue)] px-1.5 py-0.5 text-[10px] text-white sm:text-xs"
          >
            <span v-if="startTimeOn(e, d)" class="font-semibold">{{ startTimeOn(e, d) }}</span>
            {{ e.title }}
          </span>
          <span
            v-if="entriesForDay(d).length > 2"
            class="text-[10px] text-[color:var(--bs-muted)] sm:text-xs"
          >
            +{{ entriesForDay(d).length - 2 }} more
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
            >{{ i ? ", " : " " }}{{ formatTimeOfDay(b.start) }}–{{ formatTimeOfDay(b.end) }}</span
          >
        </template>
        <template v-else>Not a working day.</template>
      </p>

      <!-- Hour rail. Each row is one hour; job blocks are absolutely placed
           over it so a 09:30–11:00 job reads as an hour and a half. -->
      <div class="flex max-h-[55vh] overflow-y-auto">
        <!-- w-16: "12 p.m." needs more rail than the old "12:00" did. -->
        <div class="w-16 shrink-0">
          <div
            v-for="h in dayHours"
            :key="h"
            class="h-[44px] whitespace-nowrap pr-2 text-right text-[10px] text-[color:var(--bs-muted)]"
          >
            {{ hourLabel(h) }}
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
            :key="e.entry.key"
            type="button"
            class="absolute overflow-hidden rounded-md bg-[color:var(--bs-blue)] px-2 py-1 text-left text-xs text-white"
            :style="entryStyle(e)"
            @click="openJob(e.entry.jobId)"
          >
            <span class="block truncate font-medium">{{ e.entry.title }}</span>
            <span class="block truncate opacity-80">{{ e.timeLabel }}</span>
            <span class="block truncate opacity-80">
              {{ e.entry.note || e.entry.clientName || e.entry.trade }}
            </span>
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
        <!-- The report: book time against a job you already have on, without
             opening that job first. -->
        <Button
          v-if="isEditable && schedulableJobs.length"
          label="Add time to a job"
          icon="pi pi-plus"
          @click="openAddTime"
        />
      </template>
    </Dialog>

    <!-- ADD TIME TO A JOB -->
    <Dialog
      v-model:visible="showAdd"
      modal
      :header="`Add time — ${openDayLabel || 'this day'}`"
      :style="{ width: '92vw', maxWidth: '26rem' }"
      :draggable="false"
    >
      <label class="mb-1 block text-xs font-medium">Job</label>
      <Select
        v-model="addJobId"
        :options="jobOptions"
        option-label="label"
        option-value="value"
        placeholder="Pick a job"
        class="w-full"
        :filter="jobOptions.length > 8"
      >
        <template #option="{ option }">
          <div class="min-w-0">
            <div class="truncate text-sm">{{ option.label }}</div>
            <div class="truncate text-xs text-[color:var(--bs-muted)]">{{ option.detail }}</div>
          </div>
        </template>
      </Select>

      <div class="mt-3 grid grid-cols-2 gap-2">
        <div>
          <label class="mb-1 block text-xs font-medium">Start</label>
          <InputText v-model="addStart" placeholder="9:00 am" maxlength="10" class="w-full" />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium">End</label>
          <InputText v-model="addEnd" placeholder="12:00 pm" maxlength="10" class="w-full" />
        </div>
      </div>

      <label class="mb-1 mt-3 block text-xs font-medium">
        Note <span class="font-normal text-[color:var(--bs-muted)]">(optional)</span>
      </label>
      <Textarea
        v-model="addNote"
        rows="2"
        maxlength="500"
        class="w-full"
        placeholder="e.g. first fix"
      />

      <Message v-if="addError" severity="error" :closable="false" class="mt-3 text-xs">
        {{ addError }}
      </Message>
      <p class="mt-2 text-xs text-[color:var(--bs-muted)]">
        This books a visit on the job — the same as adding it from the job's Schedule tab. Your
        client sees it too. It doesn't log billable hours.
      </p>

      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="showAdd = false" />
        <Button
          label="Add to calendar"
          icon="pi pi-check"
          :loading="savingSession"
          @click="submitAddTime"
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
