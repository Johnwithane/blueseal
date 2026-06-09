<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import { useActiveClock } from "@/composables/useActiveClock";
import { clockOut, formatElapsed } from "@/firebase/services/timeEntries";
import { getJob } from "@/firebase/services/jobs";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

// Always-on "you're on the clock" bar, mounted globally in App.vue. The
// per-job clock controls (job header + Work Order tab) only exist on that
// job's page; once a tradesperson clocks in and navigates away there was no
// way to see the running timer or stop it. This bar follows them everywhere.
//
// Only ever shows ONE session: clockIn enforces a single running clock across
// all jobs server-side (auto-stopping any other), so useActiveClock is a
// single-doc view.
const { activeEntry, elapsedMs } = useActiveClock();
const router = useRouter();
const toast = useToast();

// Shows on every screen while a session is running — including the job's own
// page. It's redundant with that page's in-page Stop button, but the prominent
// global bar is the affordance to keep consistent everywhere.
const visible = computed(() => !!activeEntry.value);

// activeEntry is a timeEntries doc — it only carries the jobId, so fetch the
// job once per id change for its title + client name (both denormalized on the
// job). They're stable, so a one-shot read beats a live subscription; fall back
// to nulls on any miss.
const jobTitle = ref<string | null>(null);
const clientName = ref<string | null>(null);
watch(
  () => activeEntry.value?.jobId ?? null,
  async (jobId) => {
    if (!jobId) {
      jobTitle.value = null;
      clientName.value = null;
      return;
    }
    try {
      const job = await getJob(jobId);
      jobTitle.value = job?.title ?? null;
      clientName.value = job?.clientName ?? null;
    } catch {
      jobTitle.value = null;
      clientName.value = null;
    }
  },
  { immediate: true },
);

// Sub-line under the job title: who it's for, plus the session kind when it's
// not ordinary labour (so a travel / change-order clock is unmistakable).
const subtitle = computed(() => {
  const k = activeEntry.value?.kind;
  const kindPart = k === "travel" ? "Travel" : k === "extra" ? "Change order" : null;
  const whoPart = clientName.value ? `for ${clientName.value}` : null;
  return [kindPart, whoPart].filter(Boolean).join(" · ");
});

const busy = ref(false);

// The clock lives on the job's Work Order tab, so both tapping the bar and
// clocking out land there (?tab=workorder).
function openWorkOrder(jobId: string) {
  void router.push({ name: "JobDetail", params: { id: jobId }, query: { tab: "workorder" } });
}

function goToJob() {
  const jobId = activeEntry.value?.jobId;
  if (jobId) openWorkOrder(jobId);
}

// The bar is `position: sticky; top: 0`, so it shares the viewport-top with the
// app's other sticky bars (public AppHeader, desktop SidePanel). Publish our
// height as a :root CSS var so those bars can stick *below* us instead of
// underneath. Defaults to 0px when no clock runs → those bars are untouched.
const rootEl = ref<HTMLElement | null>(null);
const BANNER_H_VAR = "--bs-clock-banner-h";
function setBannerHeightVar(px: number) {
  document.documentElement.style.setProperty(BANNER_H_VAR, `${px}px`);
}
watch(
  visible,
  async (v) => {
    if (v) {
      await nextTick();
      setBannerHeightVar(rootEl.value?.offsetHeight ?? 0);
    } else {
      setBannerHeightVar(0);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => setBannerHeightVar(0));

async function onClockOut() {
  const entry = activeEntry.value;
  if (busy.value || !entry) return;
  busy.value = true;
  try {
    await clockOut(entry.jobId, entry.id);
    toast.success("Clocked out");
    // Per spec: stopping the clock returns the tradesperson to that job's
    // Work Order tab (where the time log + clock controls live).
    openWorkOrder(entry.jobId);
  } catch (e) {
    toast.error("Couldn't clock out", humanizeError(e));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="visible" ref="rootEl" class="bs-clock-banner" role="status">
    <div class="bs-container flex items-center gap-3 py-2">
      <!-- Whole left region is tappable → jump to the job's Work Order tab. -->
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        @click="goToJob"
      >
        <span class="bs-clock-banner__dot shrink-0" aria-hidden="true"></span>
        <span class="shrink-0 font-mono text-base font-bold tabular-nums">
          {{ formatElapsed(elapsedMs) }}
        </span>
        <span class="min-w-0 flex-1 leading-tight">
          <span class="block truncate text-sm font-medium">{{ jobTitle ?? "your job" }}</span>
          <span v-if="subtitle" class="block truncate text-xs opacity-75">{{ subtitle }}</span>
        </span>
      </button>
      <Button
        label="Clock out"
        icon="pi pi-stop-circle"
        severity="danger"
        size="small"
        class="shrink-0"
        :loading="busy"
        @click="onClockOut"
      />
    </div>
  </div>
</template>

<style scoped>
.bs-clock-banner {
  position: sticky;
  top: 0;
  /* Above the app chrome (AppHeader / SidePanel / BottomNav sit at z-30) but
     well below PrimeVue toasts + dialogs, so a clock-out never hides an alert. */
  z-index: 40;
  background: var(--bs-blue-dark);
  color: #fff;
  border-bottom: 1px solid rgba(0, 0, 0, 0.15);
}
.bs-clock-banner__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
  background: var(--bs-blue-light);
  /* Live "recording" pulse so the bar reads as an active timer at a glance. */
  animation: bs-clock-pulse 1.6s ease-in-out infinite;
}
@keyframes bs-clock-pulse {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(160, 214, 241, 0.6);
  }
  50% {
    opacity: 0.6;
    box-shadow: 0 0 0 0.35rem rgba(160, 214, 241, 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .bs-clock-banner__dot {
    animation: none;
  }
}
</style>
