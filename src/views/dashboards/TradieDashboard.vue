<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import Message from "primevue/message";
import Dialog from "primevue/dialog";
import DatePicker from "primevue/datepicker";
import TabBar from "@/components/TabBar.vue";
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
import JobList from "@/components/JobList.vue";
import AvailabilityEditor from "@/components/AvailabilityEditor.vue";
import MyApplicationsList from "@/components/MyApplicationsList.vue";

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const tradie = ref<WithId<TradespersonDoc> | null>(null);
const jobs = ref<WithId<JobDoc>[]>([]);
// List is the default — jobs-first triage. Board is the renamed kanban
// (clients of the dashboard don't know the term "kanban"). Calendar is
// the scheduling/blocking surface. Applied surfaces the job-board
// applications the tradie has sent — same data as /my-applications but
// co-located with the rest of their job pipeline.
type DashboardView = "list" | "board" | "calendar" | "applied";
const view = ref<DashboardView>("list");
const viewOptions: { label: string; value: DashboardView; icon: string }[] = [
  { label: "List", value: "list", icon: "pi-list" },
  { label: "Board", value: "board", icon: "pi-th-large" },
  { label: "Calendar", value: "calendar", icon: "pi-calendar" },
  { label: "Applied", value: "applied", icon: "pi-send" },
];
// Mapped to the shared TabBar's {key,label,icon} shape.
const viewTabs = computed(() =>
  viewOptions.map((o) => ({ key: o.value, label: o.label, icon: o.icon })),
);

const viewHint = computed(() => {
  if (view.value === "board") return "Pipeline overview. Tap a card to open the job.";
  if (view.value === "calendar") return "Tap a free day to block it off.";
  if (view.value === "applied") return "Jobs you've applied to, grouped by status.";
  if (showCompleted.value)
    return "Completed and cancelled jobs — tap one to revisit its invoice, receipt and reviews.";
  return "Tap a job to open it. Filter by status with the chips above.";
});

// Completed view: flips JobList to the terminal-status partition
// (complete / reviewed / cancelled). Filing is automatic — driven
// purely by job status.
const showCompleted = ref(false);

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

// Tap-to-block from the calendar view. The CalendarView component handles
// its own confirm dialog, so we just persist on emit.
async function blockDay(day: Date) {
  if (!auth.fbUser) return;
  try {
    await createBlock(auth.fbUser.uid, day, day);
    toast.success("Block-off saved");
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
  if (!idApproved.value) missing.push("ID");
  if (!hasApprovedTrade.value) missing.push("at least one certification");
  if (missing.length === 0) return "";
  return `Your application is approved — our team still needs to verify your ${missing.join(" and ")} before your profile goes live. You'll get a notification when it's done; nothing more for you to do right now.`;
});

</script>

<template>
  <section class="pb-6">
    <!-- Sticky underline-tab bar — same visual pattern as the job-detail
         JobTabBar (icon + label, active border-bottom). AppShell has no
         sticky chrome above the route slot, so top:0 is correct on both
         viewports. Inlined rather than reusing JobTabBar because that
         component is named/aria-labelled for job sections. -->
    <div class="bs-tradie-tab-bar">
      <div class="bs-container">
        <TabBar
          :tabs="viewTabs"
          :model-value="view"
          aria-label="Dashboard views"
          @update:model-value="view = $event as DashboardView"
        />
      </div>
    </div>

    <div class="bs-container pt-4">
    <p class="hidden sm:block text-[color:var(--bs-muted)] text-sm mb-4">
      {{ viewHint }}
    </p>

    <!-- Availability + block-off live with the Calendar view since that's
         where scheduling lives. Kept on their own row so the tabs above
         stay fixed in place across view switches. -->
    <div
      v-if="tradie?.isVisible && view === 'calendar'"
      class="flex items-center gap-2 mb-4"
    >
      <Button
        label="Availability"
        icon="pi pi-clock"
        outlined
        class="flex-1 min-w-0"
        @click="openAvailabilityEditor"
      />
      <Button
        label="Block time"
        icon="pi pi-ban"
        outlined
        severity="danger"
        class="flex-1 min-w-0"
        @click="openBlockEditor"
      />
    </div>

    <!-- New job (bring your own client) + Reports ride the shell's title-row
         action slot — the same top-of-page spot as the client's "Post a job"
         — instead of taking a row under the tabs. Vetted-tradie-only (same
         gate as the New-job callable). Shown across all dashboard views, like
         the client button, rather than just the list view. -->
    <Teleport
      v-if="tradie?.isVisible"
      defer
      to="#app-shell-header-action"
    >
      <Button
        label="New job"
        icon="pi pi-plus"
        size="small"
        @click="router.push('/jobs/new')"
      />
      <Button
        label="Reports"
        icon="pi pi-chart-bar"
        size="small"
        text
        @click="router.push('/reports')"
      />
    </Teleport>

    <!-- Completed-view toggle, list view only. Right-aligned on its own row,
         matching the client dashboard's toggle placement. -->
    <div
      v-if="view === 'list' && tradie?.isVisible"
      class="mb-3 flex items-center justify-end"
    >
      <Button
        :label="showCompleted ? 'Back to active jobs' : 'View completed'"
        :icon="showCompleted ? 'pi pi-arrow-left' : 'pi pi-check-circle'"
        text
        size="small"
        @click="showCompleted = !showCompleted"
      />
    </div>

    <JobList
      v-if="view === 'list' && tradie?.isVisible"
      :jobs="jobs"
      viewer-role="tradesperson"
      :show-completed="showCompleted"
    />
    <KanbanBoard v-else-if="view === 'board' && tradie?.isVisible" :jobs="jobs" />
    <CalendarView
      v-else-if="view === 'calendar' && tradie?.isVisible"
      :jobs="jobs"
      :availability="tradie.weeklyAvailability"
      :blocks="bookings"
      @remove-block="removeBlock"
      @block-day="blockDay"
    />
    <!-- Applied: job-board applications. Independent of `tradie.isVisible`
         (an unverified tradie can't actually submit applications anyway, but
         we render the list either way and let the empty state speak). -->
    <MyApplicationsList v-else-if="view === 'applied'" />

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
    </div>
  </section>
</template>

<style scoped>
/* Sticky positioning wrapper; the tab row itself is the shared <TabBar>. */
.bs-tradie-tab-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: white;
  border-bottom: 1px solid var(--bs-border);
}
</style>
