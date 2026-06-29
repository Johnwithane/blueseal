<script setup lang="ts">
// Top-of-page banner for the cancel/postpone request loop. Renders one of:
//   - tradesperson: a client request is awaiting your Accept / Decline
//   - client: your request is in flight (Withdraw)
//   - either party: the job is on hold (Resume)
// Mirrors the other JobDetailView banners (ClientApprovalBanner etc.): self-
// contained, calls the service, and emits `decided` so the parent reloads.
import { computed, ref } from "vue";
import Button from "primevue/button";
import StatusBanner from "@/components/StatusBanner.vue";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { respondJobChange, withdrawJobChange, resumeJob } from "@/firebase/services/jobs";

const props = defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
}>();

const emit = defineEmits<{ decided: [] }>();

const { dateTime } = useFormatters();
const toast = useToast();
const busy = ref(false);

const pending = computed(() => props.job.pendingChange ?? null);
const isOnHold = computed(() => props.job.status === "on_hold");
const isCancel = computed(() => pending.value?.type === "cancel");
const reason = computed(() => pending.value?.reason?.trim() || "");
const proposedResume = computed(() =>
  pending.value?.type === "postpone" && pending.value.proposedResumeAt
    ? dateTime(pending.value.proposedResumeAt)
    : null,
);

async function run(fn: () => Promise<unknown>, ok: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    await fn();
    toast.success(ok);
    emit("decided");
  } catch (e) {
    toast.error("Something went wrong", humanizeError(e));
  } finally {
    busy.value = false;
  }
}

const accept = () => run(() => respondJobChange(props.job.id, true), "Request accepted");
const decline = () => run(() => respondJobChange(props.job.id, false), "Request declined");
const withdraw = () => run(() => withdrawJobChange(props.job.id), "Request withdrawn");
const resume = () => run(() => resumeJob(props.job.id), "Job resumed");
</script>

<template>
  <!-- Tradesperson: respond to the client's request. -->
  <StatusBanner
    v-if="pending && isTradie"
    severity="action"
    icon="pi-pause"
    :title="isCancel ? 'Client wants to cancel this job' : 'Client wants to put this job on hold'"
  >
    <template #body>
      <p v-if="reason" class="text-sm text-[color:var(--bs-muted)] mt-1">
        “{{ reason }}”
      </p>
      <p v-if="proposedResume" class="text-sm text-[color:var(--bs-muted)] mt-1">
        Proposed resume: {{ proposedResume }}
      </p>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        {{
          isCancel
            ? "Accept to cancel the job, or decline to keep it going."
            : "Accept to pause the job (either of you can resume it later), or decline to keep it going."
        }}
      </p>
    </template>
    <template #actions>
      <div class="flex flex-wrap gap-2">
        <Button
          :label="isCancel ? 'Accept cancellation' : 'Accept hold'"
          icon="pi pi-check"
          :severity="isCancel ? 'danger' : 'warn'"
          size="small"
          :loading="busy"
          @click="accept"
        />
        <Button
          label="Decline"
          icon="pi pi-times"
          severity="secondary"
          outlined
          size="small"
          :disabled="busy"
          @click="decline"
        />
      </div>
    </template>
  </StatusBanner>

  <!-- Client: request is awaiting the tradesperson. -->
  <StatusBanner
    v-else-if="pending && isClient"
    severity="waiting"
    icon="pi-clock"
    :title="isCancel ? 'Cancellation requested' : 'Hold requested'"
  >
    <template #body>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        Waiting for the tradesperson to accept your request. They've been notified.
      </p>
    </template>
    <template #actions>
      <Button
        label="Withdraw request"
        icon="pi pi-undo"
        severity="secondary"
        outlined
        size="small"
        :loading="busy"
        @click="withdraw"
      />
    </template>
  </StatusBanner>

  <!-- On hold: either party can resume. -->
  <StatusBanner v-else-if="isOnHold" severity="action" icon="pi-pause" title="This job is on hold">
    <template #body>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        Work is paused. You or the {{ isClient ? "tradesperson" : "client" }}
        can resume it any time.
      </p>
    </template>
    <template #actions>
      <Button
        label="Resume job"
        icon="pi pi-play"
        severity="success"
        size="small"
        :loading="busy"
        @click="resume"
      />
    </template>
  </StatusBanner>
</template>
