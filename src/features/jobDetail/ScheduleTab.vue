<script setup lang="ts">
import Button from "primevue/button";
import DatePicker from "primevue/datepicker";
import TimeTrackerCard from "@/components/TimeTrackerCard.vue";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";

defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
  savingSchedule: boolean;
  canClientCancel: boolean;
}>();

const scheduledStart = defineModel<Date | null>("scheduledStart", { required: true });
const scheduledEnd = defineModel<Date | null>("scheduledEnd", { required: true });

const emit = defineEmits<{
  "save-schedule": [];
  "open-cancel-dialog": [];
}>();

const { dateTime } = useFormatters();
</script>

<template>
  <div class="space-y-4">
    <!-- Optional date-picking nudge while the job is active but no date
         is set yet. Scheduling no longer gates status — it's metadata
         the tradesperson can fill in (or not) to drive their calendar
         and the on-the-day time tracker. -->
    <div
      v-if="isTradie && job.status === 'in_progress' && !job.scheduledStart"
      class="bs-card p-3 border-l-4 border-l-emerald-500"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-calendar-plus text-emerald-600"></i>
        Set a visit date (optional)
      </h3>
      <p class="text-xs text-[color:var(--bs-muted)]">
        Pick start + end below to put this job on your calendar. Time
        tracking still works without a date — invoice when you're done.
      </p>
    </div>

    <div
      v-if="isClient && job.status === 'in_progress' && !job.scheduledStart"
      class="bs-card p-3 border-l-4 border-l-emerald-500"
    >
      <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
        <i class="pi pi-check text-emerald-600"></i>
        Quote accepted — job is active
      </h3>
      <p class="text-xs text-[color:var(--bs-muted)]">
        The tradesperson will reach out to confirm a visit date. You'll see
        it here once it's set.
      </p>
    </div>

    <!-- Schedule card: display + (tradie) pickers. -->
    <div class="bs-card p-3">
      <h3 class="font-semibold text-sm mb-2">Schedule</h3>
      <div v-if="job.scheduledStart" class="text-sm leading-snug">
        <div>{{ dateTime(job.scheduledStart) }}</div>
        <div class="text-[color:var(--bs-muted)]">to {{ dateTime(job.scheduledEnd) }}</div>
      </div>
      <p
        v-else-if="!isTradie"
        class="text-xs text-[color:var(--bs-muted)]"
      >Not scheduled yet.</p>

      <template v-if="isTradie">
        <div class="mt-3 space-y-2">
          <div>
            <label
              for="job-schedule-start"
              class="block text-[11px] text-[color:var(--bs-muted)] mb-1"
            >Start</label>
            <DatePicker
              v-model="scheduledStart"
              input-id="job-schedule-start"
              show-time
              hour-format="24"
              class="w-full"
              placeholder="Start"
            />
          </div>
          <div>
            <label
              for="job-schedule-end"
              class="block text-[11px] text-[color:var(--bs-muted)] mb-1"
            >End</label>
            <DatePicker
              v-model="scheduledEnd"
              input-id="job-schedule-end"
              show-time
              hour-format="24"
              class="w-full"
              placeholder="End"
            />
          </div>
        </div>
        <Button
          label="Save schedule"
          icon="pi pi-calendar"
          class="mt-3 w-full"
          outlined
          :loading="savingSchedule"
          @click="emit('save-schedule')"
        />
      </template>
    </div>

    <!-- Time tracker — visible to both parties so the client sees live
         clocked time too. -->
    <TimeTrackerCard
      :job-id="job.id"
      :tradesperson-id="job.tradespersonId"
      :is-tradie="isTradie"
    />

    <!-- Client-side cancel card — only shown while the job is in a
         cancellable status (pre-work-start). -->
    <div v-if="canClientCancel" class="bs-card p-3">
      <h3 class="font-semibold text-sm mb-2">Change of plans?</h3>
      <p class="text-xs text-[color:var(--bs-muted)] mb-2">
        You can cancel until work starts. The tradesperson will be notified.
      </p>
      <Button
        label="Cancel this job"
        icon="pi pi-ban"
        severity="danger"
        outlined
        size="small"
        class="w-full"
        @click="emit('open-cancel-dialog')"
      />
    </div>
  </div>
</template>
