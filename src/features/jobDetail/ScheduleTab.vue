<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import DatePicker from "primevue/datepicker";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";

const props = defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
  savingSchedule: boolean;
  // Pre-commitment instant cancel (cancelJob). Mutually exclusive with the
  // request flow below — a job is in exactly one of these phases.
  canInstantCancel: boolean;
  // Committed-job cancel: sends a request the tradesperson must accept.
  canRequestCancel: boolean;
  // Committed-job postpone (put on hold): also a request.
  canRequestPostpone: boolean;
}>();

const scheduledStart = defineModel<Date | null>("scheduledStart", { required: true });
const scheduledEnd = defineModel<Date | null>("scheduledEnd", { required: true });

const emit = defineEmits<{
  "save-schedule": [];
  "open-cancel-dialog": [];
  "open-postpone-dialog": [];
}>();

const showChangeCard = computed(
  () => props.canInstantCancel || props.canRequestCancel || props.canRequestPostpone,
);

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

    <!-- Time tracking + change orders now live in the Work Order tab. -->

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
  </div>
</template>
