<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import DatePicker from "primevue/datepicker";
import Select from "primevue/select";
import Textarea from "primevue/textarea";
import Message from "primevue/message";
import { addManualTimeEntry } from "@/firebase/services/timeEntries";
import type { TimeEntryKind } from "@/firebase/interfaces";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

// Log past time the tradesperson didn't clock live. Creates a closed entry via
// the addManualTimeEntry callable (rate + rules resolved server-side, same as
// clockIn). Mounted from the Work Order time card.
const props = defineProps<{
  visible: boolean;
  jobId: string;
  billingType: "hourly" | "fixed";
  // Approved HOURLY change orders the tradie can log time against.
  approvedHourlyExtras?: { id: string; description: string; hourlyRateCents: number }[];
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  added: [];
}>();

const toast = useToast();

interface KindOption {
  value: string; // unique key (kind + extraId)
  kind: TimeEntryKind;
  extraId: string | null;
  label: string;
}

// Mirrors TimeTrackerCard.clockOptions: labour always; travel only on hourly
// jobs; one option per approved hourly change order.
const kindOptions = computed<KindOption[]>(() => {
  const opts: KindOption[] = [{ value: "labour", kind: "labour", extraId: null, label: "Labour" }];
  if (props.billingType === "hourly") {
    opts.push({ value: "travel", kind: "travel", extraId: null, label: "Travel" });
  }
  for (const ex of props.approvedHourlyExtras ?? []) {
    opts.push({ value: `extra:${ex.id}`, kind: "extra", extraId: ex.id, label: ex.description });
  }
  return opts;
});

const selectedValue = ref<string>("labour");
const selectedOption = computed(
  () => kindOptions.value.find((o) => o.value === selectedValue.value) ?? kindOptions.value[0],
);

const started = ref<Date | null>(null);
const ended = ref<Date | null>(null);
const notes = ref("");
const submitting = ref(false);

// Fresh defaults each open: a one-hour window ending now, so the tradie just
// nudges the two times to match the work they're logging.
watch(
  () => props.visible,
  (v) => {
    if (!v) return;
    const now = new Date();
    started.value = new Date(now.getTime() - 60 * 60 * 1000);
    ended.value = now;
    notes.value = "";
    selectedValue.value = "labour";
    submitting.value = false;
  },
);

const durationMs = computed(() =>
  started.value && ended.value ? ended.value.getTime() - started.value.getTime() : 0,
);

const durationLabel = computed(() => {
  const mins = Math.floor(durationMs.value / 60_000);
  if (mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
});

// Qualitative billing note (the exact rate is resolved + snapshotted server-side).
const billingNote = computed(() => {
  const o = selectedOption.value;
  if (!o) return "";
  if (o.kind === "travel") return "Billed at your travel rate.";
  if (o.kind === "extra") return "Billed at the change-order rate.";
  return props.billingType === "fixed"
    ? "Tracked as a record — no charge on a fixed-price job."
    : "Billed at your hourly rate.";
});

const MAX_MS = 24 * 60 * 60 * 1000;
// Mirrors the server-side checks in addManualTimeEntry so the UI guards before
// the round-trip; the callable is still the authority.
const validationError = computed<string | null>(() => {
  if (!started.value || !ended.value) return "Pick a start and end time.";
  if (durationMs.value <= 0) return "The end time must be after the start time.";
  if (durationMs.value > MAX_MS) return "A single entry can't be longer than 24 hours.";
  if (ended.value.getTime() > Date.now() + 5 * 60 * 1000) return "You can't log time in the future.";
  return null;
});

const canSubmit = computed(() => !submitting.value && validationError.value === null);

async function onSubmit() {
  const o = selectedOption.value;
  if (!canSubmit.value || !o || !started.value || !ended.value) return;
  submitting.value = true;
  try {
    await addManualTimeEntry(props.jobId, {
      kind: o.kind,
      extraId: o.extraId,
      startedAtMs: started.value.getTime(),
      endedAtMs: ended.value.getTime(),
      notes: notes.value.trim(),
    });
    toast.success("Time added", `${durationLabel.value} logged`);
    emit("added");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't add time", humanizeError(e));
  } finally {
    submitting.value = false;
  }
}

function close() {
  if (submitting.value) return;
  emit("update:visible", false);
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :closable="!submitting"
    :draggable="false"
    header="Add time manually"
    :style="{ width: '92vw', maxWidth: '420px' }"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <div class="space-y-4">
      <p class="text-xs leading-snug text-[color:var(--bs-muted)]">
        For work you didn't clock live. It bills exactly like clocked time and shows on the
        invoice the same way.
      </p>

      <!-- Kind — only when there's a choice (travel / change orders exist). -->
      <div v-if="kindOptions.length > 1">
        <label class="mb-1 block text-[11px] text-[color:var(--bs-muted)]">What are you logging?</label>
        <Select
          v-model="selectedValue"
          :options="kindOptions"
          option-label="label"
          option-value="value"
          class="w-full"
        />
      </div>

      <div class="grid grid-cols-1 gap-3">
        <div>
          <label for="manual-start" class="mb-1 block text-[11px] text-[color:var(--bs-muted)]">Start</label>
          <DatePicker
            v-model="started"
            input-id="manual-start"
            show-time
            hour-format="24"
            class="w-full"
            placeholder="Start"
          />
        </div>
        <div>
          <label for="manual-end" class="mb-1 block text-[11px] text-[color:var(--bs-muted)]">End</label>
          <DatePicker
            v-model="ended"
            input-id="manual-end"
            show-time
            hour-format="24"
            class="w-full"
            placeholder="End"
          />
        </div>
      </div>

      <div>
        <label for="manual-notes" class="mb-1 block text-[11px] text-[color:var(--bs-muted)]">
          Notes (optional)
        </label>
        <Textarea
          id="manual-notes"
          v-model="notes"
          rows="2"
          maxlength="2000"
          class="w-full text-sm"
          placeholder="What was done (only you see this unless added to the invoice)"
        />
      </div>

      <!-- Live summary: duration + how it bills. -->
      <div
        class="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--bs-border)] p-3"
      >
        <span class="text-xs text-[color:var(--bs-muted)]">{{ billingNote }}</span>
        <span class="shrink-0 font-mono text-lg font-bold tabular-nums">{{ durationLabel }}</span>
      </div>

      <Message
        v-if="validationError && started && ended"
        severity="warn"
        :closable="false"
        class="text-xs"
      >
        {{ validationError }}
      </Message>
    </div>

    <template #footer>
      <div class="flex w-full gap-2">
        <Button label="Cancel" text :disabled="submitting" class="flex-1" @click="close" />
        <Button
          label="Add time"
          icon="pi pi-plus"
          :loading="submitting"
          :disabled="!canSubmit"
          class="flex-1"
          @click="onSubmit"
        />
      </div>
    </template>
  </Dialog>
</template>
