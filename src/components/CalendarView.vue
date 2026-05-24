<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import JobCounterparty from "@/components/JobCounterparty.vue";
import type {
  BookingDoc,
  JobDoc,
  WeeklyAvailability,
  WithId,
} from "@/firebase/interfaces";

const props = defineProps<{
  jobs: WithId<JobDoc>[];
  availability: WeeklyAvailability;
  blocks?: WithId<BookingDoc>[];
}>();
const emit = defineEmits<{
  "remove-block": [bookingId: string];
}>();
const router = useRouter();

const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
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

// Group scheduled jobs by ISO date key so both views can index in O(1).
const jobsByDateKey = computed(() => {
  const map = new Map<string, WithId<JobDoc>[]>();
  for (const job of props.jobs) {
    if (!job.scheduledStart) continue;
    const d = startOfDay(job.scheduledStart.toDate());
    const key = d.toISOString().slice(0, 10);
    const list = map.get(key) ?? [];
    list.push(job);
    map.set(key, list);
  }
  return map;
});

function dateKey(d: Date): string {
  return startOfDay(d).toISOString().slice(0, 10);
}
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
        <Button
          label="Today"
          severity="secondary"
          outlined
          size="small"
          @click="goToday"
        />
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
    <div v-if="view === 'week'" class="grid grid-cols-2 gap-2 sm:grid-cols-7">
      <div
        v-for="(d, i) in weekDays"
        :key="d.toISOString()"
        class="bs-card min-h-[16rem] p-3"
        :class="{ 'ring-2 ring-[color:var(--bs-blue)]': isSameDay(d, today) }"
      >
        <header class="mb-2 flex items-center justify-between">
          <div class="font-semibold text-sm">
            {{ dayLabels[i] }}
            <span class="ml-1 text-[color:var(--bs-muted)] font-normal">{{ d.getDate() }}</span>
          </div>
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
          class="mb-1 rounded bg-blue-50 px-2 py-1 text-xs text-blue-900"
        >
          {{ block.start }} – {{ block.end }}
        </div>
        <article
          v-for="b in blocksForDay(d)"
          :key="b.id"
          class="mt-1 flex items-center justify-between rounded-md bg-red-50 px-2 py-1 text-xs text-red-800"
        >
          <span class="flex items-center gap-1">
            <i class="pi pi-ban text-[10px]"></i>
            <span>Blocked</span>
          </span>
          <button
            type="button"
            class="text-red-700 hover:text-red-900"
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
            'bg-red-50/50': blocksForDay(d).length > 0,
          }"
        >
          <div class="mb-1 flex items-center justify-between">
            <div class="text-xs font-semibold sm:text-sm">{{ d.getDate() }}</div>
            <div class="flex items-center gap-1">
              <i
                v-if="blocksForDay(d).length > 0"
                class="pi pi-ban text-[10px] text-red-600"
                title="Blocked"
              ></i>
              <span
                v-if="props.availability[dayOfWeekKey(d)].length"
                class="h-1.5 w-1.5 rounded-full bg-[color:var(--bs-blue)]"
                :title="`${props.availability[dayOfWeekKey(d)].length} availability block(s)`"
              ></span>
            </div>
          </div>
          <article
            v-for="job in jobsForDay(d).slice(0, 2)"
            :key="job.id"
            class="mb-0.5 cursor-pointer truncate rounded bg-[color:var(--bs-blue)] px-1.5 py-0.5 text-[10px] text-white sm:text-xs"
            @click="router.push({ name: 'JobDetail', params: { id: job.id } })"
          >
            {{ job.title }}
          </article>
          <div
            v-if="jobsForDay(d).length > 2"
            class="text-[10px] text-[color:var(--bs-muted)] sm:text-xs"
          >
            +{{ jobsForDay(d).length - 2 }} more
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
