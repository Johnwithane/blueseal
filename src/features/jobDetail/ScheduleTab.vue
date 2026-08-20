<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Button from "primevue/button";
import DatePicker from "primevue/datepicker";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import type { JobDoc, SessionDoc, WithId } from "@/firebase/interfaces";
import { getQuoteByJobId } from "@/firebase/services/quotes";
import JobScheduleCalendar from "@/features/jobDetail/JobScheduleCalendar.vue";

const props = defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
  // Booked work sessions for this job (live-subscribed by the parent).
  sessions: WithId<SessionDoc>[];
  savingSession: boolean;
  // Pre-commitment instant cancel (cancelJob). Mutually exclusive with the
  // request flow below — a job is in exactly one of these phases.
  canInstantCancel: boolean;
  // Committed-job cancel: sends a request the tradesperson must accept.
  canRequestCancel: boolean;
  // Committed-job postpone (put on hold): also a request.
  canRequestPostpone: boolean;
}>();

const emit = defineEmits<{
  // sessionId null ⇒ create, set ⇒ update. Parent runs collision detection
  // and the actual write (so it can reuse the schedule-conflict dialog).
  "save-session": [payload: { sessionId: string | null; start: Date; end: Date; note: string }];
  "delete-session": [sessionId: string];
  "open-cancel-dialog": [];
  "open-postpone-dialog": [];
}>();

const showChangeCard = computed(
  () => props.canInstantCancel || props.canRequestCancel || props.canRequestPostpone,
);

// The projected start date the quote agreed on (proposedStartDate). It never
// reached the Schedule tab, so the tradesperson re-found it manually and the
// client had no reminder (P2-19). Fetch it off the accepted quote and surface
// it. Stored at UTC midnight (a calendar date), so read + format in UTC.
const agreedStart = ref<Date | null>(null);
onMounted(async () => {
  try {
    const q = await getQuoteByJobId(props.job.id);
    agreedStart.value = q?.proposedStartDate ? q.proposedStartDate.toDate() : null;
  } catch {
    agreedStart.value = null;
  }
});
const agreedStartLabel = computed(() =>
  agreedStart.value
    ? agreedStart.value.toLocaleDateString("en-CA", {
        timeZone: "UTC",
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "",
);

// Open the add-session dialog defaulted to the agreed start date so the
// tradesperson can book it in one tap. Uses the UTC calendar-date parts as a
// local date (the picker works in local time).
function bookAgreedStart() {
  const d = agreedStart.value;
  if (!d) return;
  const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  openAdd(local);
}

// --- Add / edit session dialog -------------------------------------------
const showDialog = ref(false);
const editingId = ref<string | null>(null);
const formDate = ref<Date | null>(null);
const formStart = ref<Date | null>(null);
const formEnd = ref<Date | null>(null);
const formNote = ref("");
const formError = ref("");

function defaultTime(hour: number): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}

function openAdd(day: Date) {
  editingId.value = null;
  formDate.value = day;
  formStart.value = defaultTime(9);
  formEnd.value = defaultTime(17);
  formNote.value = "";
  formError.value = "";
  showDialog.value = true;
}

function openEdit(session: WithId<SessionDoc>) {
  editingId.value = session.id;
  const start = session.start.toDate();
  formDate.value = start;
  formStart.value = start;
  formEnd.value = session.end.toDate();
  formNote.value = session.note;
  formError.value = "";
  showDialog.value = true;
}

// Fold the chosen day (date part) together with each time picker's clock part
// into a single instant — the time pickers carry today's date, which we ignore.
function combine(date: Date, time: Date): Date {
  const d = new Date(date);
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return d;
}

function save() {
  if (!formDate.value || !formStart.value || !formEnd.value) {
    formError.value = "Pick a date, start and end time.";
    return;
  }
  const start = combine(formDate.value, formStart.value);
  const end = combine(formDate.value, formEnd.value);
  if (end <= start) {
    formError.value = "End time must be after the start time.";
    return;
  }
  formError.value = "";
  emit("save-session", {
    sessionId: editingId.value,
    start,
    end,
    note: formNote.value.trim(),
  });
  showDialog.value = false;
}

function removeSession() {
  if (editingId.value) emit("delete-session", editingId.value);
  showDialog.value = false;
}
</script>

<template>
  <div class="space-y-4">
    <!-- Tradie nudge while the job is active but nothing's booked yet.
         Scheduling is metadata that drives the calendar + on-the-day timer;
         it doesn't gate status. -->
    <div
      v-if="isTradie && job.status === 'in_progress' && sessions.length === 0"
      class="bs-card p-3 border-l-4 border-l-[color:var(--bs-success)]"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-calendar-plus text-[color:var(--bs-success)]"></i>
        Book your first visit (optional)
      </h3>
      <p v-if="agreedStart" class="text-xs mb-1">
        Your quote proposed a start of <strong>{{ agreedStartLabel }}</strong>.
      </p>
      <p class="text-xs text-[color:var(--bs-muted)]">
        Tap a day on the calendar below to book when you'll be on site — add as
        many visits as the job needs. Time tracking still works without a date.
      </p>
      <Button
        v-if="agreedStart"
        label="Book the agreed start"
        icon="pi pi-calendar-plus"
        size="small"
        class="mt-2"
        @click="bookAgreedStart"
      />
    </div>

    <div
      v-if="isClient && job.status === 'in_progress' && sessions.length === 0"
      class="bs-card p-3 border-l-4 border-l-[color:var(--bs-success)]"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-check text-[color:var(--bs-success)]"></i>
        Quote accepted — job is active
      </h3>
      <p v-if="agreedStart" class="text-xs mb-1">
        Projected start from your quote: <strong>{{ agreedStartLabel }}</strong>.
      </p>
      <p class="text-xs text-[color:var(--bs-muted)]">
        The tradesperson will reach out to confirm visit dates. You'll see every
        booked visit here once they're set.
      </p>
    </div>

    <!-- The calendar: this job's booked visits. Tradie can add/edit; the
         client sees it read-only. -->
    <div class="bs-card p-3">
      <h3 class="font-semibold text-sm mb-3">Booked visits</h3>
      <JobScheduleCalendar
        :sessions="sessions"
        :can-edit="isTradie"
        @add-day="openAdd"
        @edit-session="openEdit"
      />
    </div>

    <!-- Client-side "change of plans" card. Before a quote is accepted the
         client can cancel instantly; once the tradesperson is committed,
         cancelling or pausing becomes a request they must accept. -->
    <div v-if="showChangeCard" class="bs-card p-3">
      <h3 class="font-semibold text-sm mb-2">Change of plans?</h3>
      <p class="text-xs text-[color:var(--bs-muted)] mb-3">
        <template v-if="canRequestCancel || canRequestPostpone">
          The tradesperson is committed to this job, so cancelling or putting it
          on hold sends them a request to accept first.
        </template>
        <template v-else>
          You can cancel until work starts. The tradesperson will be notified.
        </template>
      </p>
      <div class="flex flex-col gap-2">
        <Button
          v-if="canRequestPostpone"
          label="Put job on hold"
          icon="pi pi-pause"
          severity="secondary"
          outlined
          size="small"
          class="w-full"
          @click="emit('open-postpone-dialog')"
        />
        <Button
          v-if="canInstantCancel || canRequestCancel"
          :label="canRequestCancel ? 'Request cancellation' : 'Cancel this job'"
          icon="pi pi-ban"
          severity="danger"
          outlined
          size="small"
          class="w-full"
          @click="emit('open-cancel-dialog')"
        />
      </div>
    </div>

    <!-- Add / edit a booked visit. Tradie only (client never opens it). -->
    <Dialog
      v-model:visible="showDialog"
      modal
      :header="editingId ? 'Edit visit' : 'Book a visit'"
      :style="{ width: '90vw', maxWidth: '24rem' }"
      :draggable="false"
    >
      <div class="space-y-3">
        <div>
          <label for="session-date" class="block text-[11px] text-[color:var(--bs-muted)] mb-1">Date</label>
          <DatePicker v-model="formDate" input-id="session-date" class="w-full" placeholder="Date" />
        </div>
        <div class="flex gap-2">
          <div class="flex-1">
            <label for="session-start" class="block text-[11px] text-[color:var(--bs-muted)] mb-1">Start</label>
            <DatePicker
              v-model="formStart"
              input-id="session-start"
              time-only
              hour-format="12"
              class="w-full"
              placeholder="Start"
            />
          </div>
          <div class="flex-1">
            <label for="session-end" class="block text-[11px] text-[color:var(--bs-muted)] mb-1">End</label>
            <DatePicker
              v-model="formEnd"
              input-id="session-end"
              time-only
              hour-format="12"
              class="w-full"
              placeholder="End"
            />
          </div>
        </div>
        <div>
          <label for="session-note" class="block text-[11px] text-[color:var(--bs-muted)] mb-1">Note (optional)</label>
          <Textarea
            id="session-note"
            v-model="formNote"
            rows="2"
            auto-resize
            class="w-full"
            placeholder="e.g. first fix, snagging"
          />
        </div>
        <p v-if="formError" class="text-xs text-[color:var(--bs-danger)]">{{ formError }}</p>
      </div>
      <template #footer>
        <Button
          v-if="editingId"
          label="Delete"
          icon="pi pi-trash"
          severity="danger"
          text
          class="mr-auto"
          @click="removeSession"
        />
        <Button label="Cancel" severity="secondary" text @click="showDialog = false" />
        <Button
          :label="editingId ? 'Save' : 'Book visit'"
          icon="pi pi-calendar-plus"
          :loading="savingSession"
          @click="save"
        />
      </template>
    </Dialog>
  </div>
</template>
