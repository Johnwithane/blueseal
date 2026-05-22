<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import Message from "primevue/message";
import Dialog from "primevue/dialog";
import DatePicker from "primevue/datepicker";
import { useAuthStore } from "@/stores/auth";
import { getTradesperson, setWeeklyAvailability } from "@/firebase/services/tradespeople";
import { subscribeTradieJobs } from "@/firebase/services/jobs";
import {
  createBlock,
  createBlocksBatch,
  deleteBooking,
  subscribeBookings,
} from "@/firebase/services/bookings";
import {
  fridaysForNextWeeks,
  weekdaysForNextMonth,
  weekendsThroughYearEnd,
  type DateRange,
} from "@/utils/blockPatterns";
import { weeklyAvailabilitySchema } from "@/validation/schemas";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type {
  BookingDoc,
  JobDoc,
  TradespersonDoc,
  WeeklyAvailability,
  WithId,
} from "@/firebase/interfaces";
import KanbanBoard from "@/components/KanbanBoard.vue";
import CalendarView from "@/components/CalendarView.vue";
import AvailabilityEditor from "@/components/AvailabilityEditor.vue";

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const tradie = ref<WithId<TradespersonDoc> | null>(null);
const jobs = ref<WithId<JobDoc>[]>([]);
const view = ref<"kanban" | "calendar">("kanban");
const viewOptions = [
  { label: "Kanban", value: "kanban" },
  { label: "Calendar", value: "calendar" },
];

const availabilityOpen = ref(false);
const draftAvailability = ref<WeeklyAvailability | null>(null);
const savingAvailability = ref(false);
const availabilityError = ref<string | null>(null);

const bookings = ref<WithId<BookingDoc>[]>([]);
const blockOpen = ref(false);
const blockRange = ref<Date[] | null>(null);
const savingBlock = ref(false);
const blockError = ref<string | null>(null);

// Block-off pattern: 'custom' uses the inline range picker; the other three
// hardcode an absolute set of single-day ranges via utils/blockPatterns.
type BlockPattern =
  | "custom"
  | "weekendsToYearEnd"
  | "fridays8"
  | "weekdaysNextMonth";
const blockPattern = ref<BlockPattern>("custom");
const patternOptions = [
  { label: "Custom range", value: "custom" as const },
  { label: "Weekends through year-end", value: "weekendsToYearEnd" as const },
  { label: "Fridays for 8 weeks", value: "fridays8" as const },
  { label: "Weekdays for next month", value: "weekdaysNextMonth" as const },
];
const patternPreview = computed<DateRange[]>(() => {
  switch (blockPattern.value) {
    case "weekendsToYearEnd":
      return weekendsThroughYearEnd();
    case "fridays8":
      return fridaysForNextWeeks(8);
    case "weekdaysNextMonth":
      return weekdaysForNextMonth();
    default:
      return [];
  }
});
const patternPreviewSummary = computed(() => {
  const r = patternPreview.value;
  if (r.length === 0) return "";
  const first = r[0].start;
  const last = r[r.length - 1].end;
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${r.length} day${r.length === 1 ? "" : "s"} blocked — ${fmt(first)} to ${fmt(last)}`;
});

let unsub: (() => void) | null = null;
let unsubBookings: (() => void) | null = null;

onMounted(async () => {
  if (!auth.fbUser) return;
  tradie.value = await getTradesperson(auth.fbUser.uid);
  if (!tradie.value || tradie.value.vettingStatus === "draft") {
    router.replace({ name: "TradieOnboarding" });
    return;
  }
  unsub = subscribeTradieJobs(auth.fbUser.uid, (j) => (jobs.value = j));
  unsubBookings = subscribeBookings(auth.fbUser.uid, (b) => (bookings.value = b));
});

onUnmounted(() => {
  unsub?.();
  unsubBookings?.();
});

function openAvailabilityEditor() {
  if (!tradie.value) return;
  // Deep-clone so cancelling discards edits without mutating the live doc.
  draftAvailability.value = JSON.parse(
    JSON.stringify(tradie.value.weeklyAvailability),
  ) as WeeklyAvailability;
  availabilityError.value = null;
  availabilityOpen.value = true;
}

function openBlockEditor() {
  // Default to today as a single-day range.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  blockRange.value = [today, today];
  blockPattern.value = "custom";
  blockError.value = null;
  blockOpen.value = true;
}

async function saveBlock() {
  if (!auth.fbUser) return;
  savingBlock.value = true;
  blockError.value = null;
  try {
    if (blockPattern.value === "custom") {
      if (!blockRange.value || blockRange.value.length === 0 || !blockRange.value[0]) {
        blockError.value = "Pick at least one date.";
        return;
      }
      const [start, end] = blockRange.value;
      await createBlock(auth.fbUser.uid, start, end ?? start);
      toast.success("Block-off saved");
    } else {
      const ranges = patternPreview.value;
      if (ranges.length === 0) {
        blockError.value = "That preset has no dates to block.";
        return;
      }
      const count = await createBlocksBatch(auth.fbUser.uid, ranges);
      toast.success(`Blocked ${count} day${count === 1 ? "" : "s"}`);
    }
    blockOpen.value = false;
  } catch (e) {
    blockError.value = humanizeError(e);
  } finally {
    savingBlock.value = false;
  }
}

async function removeBlock(bookingId: string) {
  try {
    await deleteBooking(bookingId);
    toast.success("Block removed");
  } catch (e) {
    toast.error(humanizeError(e));
  }
}

async function saveAvailability() {
  if (!auth.fbUser || !draftAvailability.value || !tradie.value) return;
  const parsed = weeklyAvailabilitySchema.safeParse(draftAvailability.value);
  if (!parsed.success) {
    availabilityError.value =
      parsed.error.issues[0]?.message ??
      "Times must be in HH:MM format (00:00 to 23:59).";
    return;
  }
  // Sanity check: every block must have end > start.
  for (const day of Object.values(parsed.data)) {
    for (const block of day) {
      if (block.end <= block.start) {
        availabilityError.value = "Each block's end time must be after its start.";
        return;
      }
    }
  }
  savingAvailability.value = true;
  availabilityError.value = null;
  try {
    await setWeeklyAvailability(auth.fbUser.uid, parsed.data);
    tradie.value.weeklyAvailability = parsed.data;
    availabilityOpen.value = false;
    toast.success("Availability saved");
  } catch (e) {
    availabilityError.value = humanizeError(e);
  } finally {
    savingAvailability.value = false;
  }
}

// Vetting status drives the "Your profile isn't live yet" empty state below.
// The full status messaging (pending / info-requested / rejected) is rendered
// app-wide by TradieStatusBanner so the user sees it on every page.
const vetting = computed(() => tradie.value?.vettingStatus);

// Three reasons isVisible can still be false even after the admin approves:
// ID not yet approved, no approved cert yet, or vettingStatus isn't approved.
// Distinguish them so the empty state tells the user the truth (waiting on
// admin) instead of telling them to redo onboarding.
const idApproved = computed(() => tradie.value?.idVerified === true);
const hasApprovedTrade = computed(
  () => (tradie.value?.verifiedTrades?.length ?? 0) > 0,
);
const awaitingVerification = computed(
  () =>
    !!tradie.value &&
    !tradie.value.isVisible &&
    vetting.value === "approved" &&
    (!idApproved.value || !hasApprovedTrade.value),
);
const awaitingVerificationMessage = computed(() => {
  const missing: string[] = [];
  if (!idApproved.value) missing.push("ID verification");
  if (!hasApprovedTrade.value) missing.push("at least one certification");
  if (missing.length === 0) return "";
  return `Your application is approved. We're finishing ${missing.join(" and ")} — you'll go live automatically once that's done.`;
});
</script>

<template>
  <section class="bs-container py-6">
    <div class="flex items-start justify-between gap-4 mb-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold">Your jobs</h1>
        <p class="text-[color:var(--bs-muted)] text-sm">
          Drag cards between columns to update status.
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <SelectButton v-model="view" :options="viewOptions" option-label="label" option-value="value" />
        <template v-if="tradie?.isVisible">
          <Button
            label="Manage availability"
            icon="pi pi-clock"
            outlined
            @click="openAvailabilityEditor"
          />
          <Button
            label="Block off time"
            icon="pi pi-ban"
            outlined
            severity="danger"
            @click="openBlockEditor"
          />
          <RouterLink to="/jobs/browse">
            <Button label="Browse open jobs" icon="pi pi-megaphone" outlined />
          </RouterLink>
          <RouterLink to="/my-applications">
            <Button label="My applications" icon="pi pi-send" text />
          </RouterLink>
        </template>
      </div>
    </div>

    <KanbanBoard v-if="view === 'kanban' && tradie?.isVisible" :jobs="jobs" />
    <CalendarView
      v-else-if="view === 'calendar' && tradie?.isVisible"
      :jobs="jobs"
      :availability="tradie.weeklyAvailability"
      :blocks="bookings"
      @remove-block="removeBlock"
    />

    <div
      v-if="awaitingVerification"
      class="bs-empty mt-4"
    >
      <i class="pi pi-check-circle text-3xl mb-2 block text-[color:var(--bs-blue)]"></i>
      <p>{{ awaitingVerificationMessage }}</p>
    </div>
    <div
      v-else-if="!tradie?.isVisible && vetting !== 'pending'"
      class="bs-empty mt-4"
    >
      <i class="pi pi-clock text-3xl mb-2 block"></i>
      <p>Your profile isn't live yet. Finish onboarding to start receiving requests.</p>
      <RouterLink to="/onboarding" class="inline-block mt-3">
        <Button label="Continue onboarding" icon="pi pi-arrow-right" />
      </RouterLink>
    </div>

    <Dialog
      v-model:visible="availabilityOpen"
      modal
      header="Manage weekly availability"
      :style="{ width: '90vw', maxWidth: '40rem' }"
      :draggable="false"
    >
      <p class="mb-3 text-sm text-[color:var(--bs-muted)]">
        Set the hours you're typically available each day. Clients see this on
        your public profile and use it when requesting quotes.
      </p>
      <Message
        v-if="availabilityError"
        severity="error"
        :closable="false"
        class="mb-3"
      >
        {{ availabilityError }}
      </Message>
      <AvailabilityEditor v-if="draftAvailability" v-model="draftAvailability" />
      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          text
          @click="availabilityOpen = false"
        />
        <Button
          label="Save"
          icon="pi pi-save"
          :loading="savingAvailability"
          @click="saveAvailability"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="blockOpen"
      modal
      header="Block off time"
      :style="{ width: '90vw', maxWidth: '28rem' }"
      :draggable="false"
    >
      <p class="mb-3 text-sm text-[color:var(--bs-muted)]">
        Mark dates as unavailable (vacation, training, anything that should
        block bookings). Pick a single day or a range.
      </p>
      <Message
        v-if="blockError"
        severity="error"
        :closable="false"
        class="mb-3"
      >
        {{ blockError }}
      </Message>
      <SelectButton
        v-model="blockPattern"
        :options="patternOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        class="mb-3 w-full"
      />
      <DatePicker
        v-if="blockPattern === 'custom'"
        v-model="blockRange"
        selection-mode="range"
        :manual-input="false"
        inline
        :min-date="new Date()"
        class="w-full"
      />
      <div
        v-else
        class="rounded-lg border border-[color:var(--bs-border)] bg-[color:var(--bs-surface-alt)] p-3 text-sm"
      >
        <div class="font-semibold">{{ patternPreviewSummary }}</div>
        <p class="mt-1 text-[color:var(--bs-muted)]">
          You can delete individual days later from the calendar view if plans
          change. Existing blocks aren't touched.
        </p>
      </div>
      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          text
          @click="blockOpen = false"
        />
        <Button
          label="Save block"
          icon="pi pi-save"
          severity="danger"
          :loading="savingBlock"
          @click="saveBlock"
        />
      </template>
    </Dialog>
  </section>
</template>
