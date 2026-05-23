<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
import Message from "primevue/message";
import {
  clockIn,
  clockOut,
  deleteTimeEntry,
  entryBillable,
  formatElapsed,
  subscribeJobTimeEntries,
  updateTimeEntryNotes,
} from "@/firebase/services/timeEntries";
import type { TimeEntryDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  jobId: string;
  isTradie: boolean;
}>();

const { dateTime, money } = useFormatters();
const toast = useToast();

const entries = ref<WithId<TimeEntryDoc>[]>([]);
const loading = ref(true);
const busy = ref(false);
// Re-render tick so the live timer on the running entry counts up.
const nowMs = ref(Date.now());
let ticker: number | null = null;

const runningEntry = computed(() => entries.value.find((e) => e.endedAt === null) ?? null);
const closedEntries = computed(() => entries.value.filter((e) => e.endedAt !== null));
const totalBilled = computed(() =>
  entries.value.reduce((acc, e) => acc + entryBillable(e, nowMs.value).billedAmount, 0),
);
const totalElapsedMs = computed(() =>
  entries.value.reduce((acc, e) => acc + entryBillable(e, nowMs.value).elapsedMs, 0),
);

let unsubscribe: (() => void) | null = null;
function attach() {
  unsubscribe?.();
  loading.value = true;
  unsubscribe = subscribeJobTimeEntries(props.jobId, (list) => {
    entries.value = list;
    loading.value = false;
  });
}

onMounted(() => {
  attach();
  // 1s tick is plenty for a clock display; cheap.
  ticker = window.setInterval(() => (nowMs.value = Date.now()), 1000);
});
onBeforeUnmount(() => {
  unsubscribe?.();
  if (ticker !== null) window.clearInterval(ticker);
});
watch(() => props.jobId, attach);

async function onClockIn() {
  if (busy.value) return;
  busy.value = true;
  try {
    await clockIn(props.jobId);
    toast.success("Clocked in");
  } catch (e) {
    toast.error("Couldn't clock in", humanizeError(e));
  } finally {
    busy.value = false;
  }
}

async function onClockOut() {
  if (busy.value || !runningEntry.value) return;
  busy.value = true;
  try {
    const res = await clockOut(props.jobId, runningEntry.value.id);
    toast.success(
      "Clocked out",
      `${Math.floor(res.elapsedMinutes / 60)}h ${res.elapsedMinutes % 60}m logged`,
    );
  } catch (e) {
    toast.error("Couldn't clock out", humanizeError(e));
  } finally {
    busy.value = false;
  }
}

async function saveNotes(entry: WithId<TimeEntryDoc>, notes: string) {
  try {
    await updateTimeEntryNotes(props.jobId, entry.id, notes);
  } catch (e) {
    toast.error("Couldn't save note", humanizeError(e));
  }
}

async function remove(entry: WithId<TimeEntryDoc>) {
  if (!confirm("Delete this time entry?")) return;
  try {
    await deleteTimeEntry(props.jobId, entry.id);
    toast.success("Entry deleted");
  } catch (e) {
    toast.error("Couldn't delete", humanizeError(e));
  }
}

function liveElapsedLabel(e: WithId<TimeEntryDoc>): string {
  return formatElapsed(entryBillable(e, nowMs.value).elapsedMs);
}
function liveBilledLabel(e: WithId<TimeEntryDoc>): string {
  return money(entryBillable(e, nowMs.value).billedAmount);
}
function rateLabel(e: WithId<TimeEntryDoc>): string {
  if (!e.hourlyRateSnapshot) return "No rate";
  return `${money(e.hourlyRateSnapshot)}/hr`;
}
</script>

<template>
  <div class="bs-card p-4">
    <header class="flex items-center justify-between mb-2">
      <div>
        <h3 class="font-semibold">Time</h3>
        <div class="text-xs text-[color:var(--bs-muted)]">
          <template v-if="totalElapsedMs > 0">
            {{ formatElapsed(totalElapsedMs) }} logged
            <template v-if="totalBilled > 0"> • {{ money(totalBilled) }}</template>
          </template>
          <template v-else>No time logged yet</template>
        </div>
      </div>
      <Tag v-if="runningEntry" value="Live" severity="success" icon="pi pi-circle-fill" />
    </header>

    <!-- Big clock button (tradie only) -->
    <div v-if="props.isTradie" class="mt-2">
      <Button
        v-if="!runningEntry"
        label="Clock in"
        icon="pi pi-play"
        class="w-full"
        :loading="busy"
        :disabled="busy"
        @click="onClockIn"
      />
      <div v-else class="rounded-lg border border-[color:var(--bs-border)] p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs text-[color:var(--bs-muted)]">In progress</div>
            <div class="font-mono text-2xl font-bold tabular-nums">
              {{ liveElapsedLabel(runningEntry) }}
            </div>
            <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
              {{ rateLabel(runningEntry) }} • {{ liveBilledLabel(runningEntry) }}
            </div>
          </div>
          <Button
            label="Stop"
            icon="pi pi-stop"
            severity="danger"
            :loading="busy"
            :disabled="busy"
            @click="onClockOut"
          />
        </div>
      </div>
    </div>

    <!-- Read-only client view of the running session -->
    <div
      v-else-if="runningEntry"
      class="mt-2 rounded-lg border border-[color:var(--bs-border)] p-3"
    >
      <div class="text-xs text-[color:var(--bs-muted)]">Tradesperson is on the clock</div>
      <div class="font-mono text-2xl font-bold tabular-nums">
        {{ liveElapsedLabel(runningEntry) }}
      </div>
      <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
        Started {{ dateTime(runningEntry.startedAt) }}
      </div>
    </div>

    <div v-if="loading" class="bs-empty mt-3">Loading…</div>
    <Message
      v-else-if="closedEntries.length === 0 && !runningEntry"
      severity="info"
      :closable="false"
      class="mt-3"
    >
      <template v-if="props.isTradie">
        Hit "Clock in" when you start. The client sees the running timer too — no surprises on the
        invoice.
      </template>
      <template v-else>
        Your tradesperson clocks in/out from their phone. You'll see hours rack up here in real
        time.
      </template>
    </Message>

    <ul v-else class="mt-3 space-y-2">
      <li
        v-for="e in closedEntries"
        :key="e.id"
        class="rounded-lg border border-[color:var(--bs-border)] p-3"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">
              {{ dateTime(e.startedAt) }} → {{ dateTime(e.endedAt) }}
            </div>
            <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
              {{ formatElapsed(entryBillable(e, nowMs).elapsedMs) }} •
              {{ rateLabel(e) }} •
              {{ money(entryBillable(e, nowMs).billedAmount) }}
              <Tag
                v-if="e.invoicedAt"
                value="Invoiced"
                severity="secondary"
                class="ml-2"
              />
            </div>
          </div>
          <Button
            v-if="props.isTradie && !e.invoicedAt"
            text
            icon="pi pi-times"
            size="small"
            severity="danger"
            aria-label="Delete entry"
            @click="remove(e)"
          />
        </div>
        <Textarea
          v-if="props.isTradie"
          :model-value="e.notes"
          rows="2"
          maxlength="2000"
          placeholder="Notes (optional, only you can see these unless added to invoice)"
          class="w-full mt-2 text-sm"
          @blur="(ev) => saveNotes(e, (ev.target as HTMLTextAreaElement).value)"
        />
        <div v-else-if="e.notes" class="text-xs mt-2 whitespace-pre-wrap">{{ e.notes }}</div>
      </li>
    </ul>
  </div>
</template>
