<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Avatar from "primevue/avatar";
import {
  countIncompleteOnboarding,
  listPendingApplications,
} from "@/firebase/services/tradespeople";
import { listOpenDisputes } from "@/firebase/services/disputes";
import { listSupportTickets } from "@/firebase/services/support";
import { listErrorLogs } from "@/firebase/services/errorReporting";
import { listAllBugReports } from "@/firebase/services/bugReports";
import { listAllProspects } from "@/firebase/services/prospects";
import { getPlatformStats } from "@/firebase/services/platformStats";
import type {
  PlatformStatsDoc,
  TradespersonDoc,
  WithId,
} from "@/firebase/interfaces";
import { useFormatters } from "@/composables";
import { tradeLabel } from "@/data/trades";
import LoadingState from "@/components/LoadingState.vue";

const { relativeTime } = useFormatters();

// Pending vetting drives both the count tile and the work list below, so it's
// the one query whose full result we keep around.
const pending = ref<WithId<TradespersonDoc>[]>([]);
const loading = ref(true);

// Action-queue counts. Each is the number of items in that admin queue that
// still need attention (see the per-queue filters in load()). They default to
// 0 so the tiles render immediately and fill in as the queries settle.
const disputeCount = ref(0);
const supportCount = ref(0);
const errorCount = ref(0);
const bugCount = ref(0);
const prospectCount = ref(0);
const incompleteOnboardingCount = ref(0);

const platform = ref<PlatformStatsDoc | null>(null);

// Tone → semantic colour tokens (main.css). Drives the tile icon chip + count.
type Tone = "info" | "warning" | "danger" | "neutral";
const TONES: Record<Tone, { tint: string; text: string; icon: string }> = {
  info: { tint: "var(--bs-info-tint)", text: "var(--bs-info-text)", icon: "var(--bs-info)" },
  warning: { tint: "var(--bs-warning-tint)", text: "var(--bs-warning-text)", icon: "var(--bs-warning)" },
  danger: { tint: "var(--bs-danger-tint)", text: "var(--bs-danger-text)", icon: "var(--bs-danger)" },
  neutral: { tint: "var(--bs-surface-alt)", text: "var(--bs-text)", icon: "var(--bs-muted)" },
};

// The queues an admin works through. `tone` is the colour when the queue has
// items; an empty queue renders calm/muted so a full one draws the eye.
const queueTiles = computed(() => {
  const defs: Array<{
    key: string;
    to: string;
    label: string;
    icon: string;
    count: number;
    tone: Tone;
  }> = [
    { key: "vetting", to: "/admin/vetting", label: "Vetting queue", icon: "pi-shield", count: pending.value.length, tone: "info" },
    { key: "onboarding", to: "/admin/onboarding", label: "Incomplete signups", icon: "pi-user-plus", count: incompleteOnboardingCount.value, tone: "warning" },
    { key: "disputes", to: "/admin/disputes", label: "Open disputes", icon: "pi-flag", count: disputeCount.value, tone: "danger" },
    { key: "support", to: "/admin/support", label: "Support tickets", icon: "pi-question-circle", count: supportCount.value, tone: "warning" },
    { key: "errors", to: "/admin/errors", label: "Unresolved errors", icon: "pi-exclamation-triangle", count: errorCount.value, tone: "danger" },
    { key: "bugs", to: "/admin/bug-reports", label: "Open bug reports", icon: "pi-bug", count: bugCount.value, tone: "warning" },
    { key: "prospects", to: "/admin/prospects", label: "Prospects", icon: "pi-send", count: prospectCount.value, tone: "neutral" },
  ];
  return defs.map((d) => {
    const active = d.count > 0;
    const t = TONES[active ? d.tone : "neutral"];
    return {
      ...d,
      active,
      chipStyle: { backgroundColor: t.tint, color: t.icon },
      countStyle: { color: active ? t.text : "var(--bs-muted)" },
    };
  });
});

// Management areas — CRUD / tools with no actionable count, just a way in.
const manageTiles = [
  { to: "/admin/users", label: "Users", icon: "pi-users", desc: "Search & 360 view" },
  { to: "/admin/jobs", label: "Jobs & postings", icon: "pi-briefcase", desc: "All jobs by region" },
  { to: "/admin/site-content", label: "Site content", icon: "pi-file-edit", desc: "Help & legal pages" },
  { to: "/admin/business-cards", label: "Business cards", icon: "pi-id-card", desc: "Generate cards" },
  { to: "/admin/rebate-programs", label: "Rebates", icon: "pi-gift", desc: "Rebate programs" },
  { to: "/admin/regions", label: "Regions", icon: "pi-map-marker", desc: "Sales territories" },
];

const platformStats = computed(() => [
  { label: "Verified pros", value: platform.value?.verifiedPros },
  { label: "Jobs posted", value: platform.value?.jobs },
  { label: "Jobs completed", value: platform.value?.jobsCompleted },
]);

function nameOf(t: WithId<TradespersonDoc>): string {
  return t.displayName?.trim() || tradeLabel(t.trades[0] ?? "") || "Unnamed applicant";
}

function initialOf(t: WithId<TradespersonDoc>): string {
  return nameOf(t).slice(0, 1).toUpperCase() || "?";
}

onMounted(async () => {
  loading.value = true;
  // One parallel fan-out; allSettled so a single denied/failed query degrades
  // that one tile to 0 rather than blanking the whole dashboard.
  const [apps, onboarding, disputes, tickets, errors, bugs, prospects, stats] =
    await Promise.allSettled([
      listPendingApplications(),
      countIncompleteOnboarding(),
      listOpenDisputes(),
      listSupportTickets(),
      listErrorLogs(),
      listAllBugReports(),
      listAllProspects(),
      getPlatformStats(),
    ]);

  if (apps.status === "fulfilled") pending.value = apps.value;
  if (onboarding.status === "fulfilled") incompleteOnboardingCount.value = onboarding.value;
  if (disputes.status === "fulfilled") disputeCount.value = disputes.value.length;
  if (tickets.status === "fulfilled")
    supportCount.value = tickets.value.filter(
      (t) => t.status === "open" || t.status === "in_progress",
    ).length;
  if (errors.status === "fulfilled")
    errorCount.value = errors.value.filter((e) => !e.resolved).length;
  if (bugs.status === "fulfilled")
    bugCount.value = bugs.value.filter(
      (b) => b.status !== "fixed" && b.status !== "wontfix",
    ).length;
  if (prospects.status === "fulfilled") prospectCount.value = prospects.value.length;
  if (stats.status === "fulfilled") platform.value = stats.value;

  loading.value = false;
});
</script>

<template>
  <section class="bs-container py-8">
    <!-- Action queues — the work that needs an admin. Tiles colour up when a
         queue has items so a full queue draws the eye; an empty one stays calm. -->
    <h2 class="text-base font-semibold mb-3">Needs attention</h2>
    <div class="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
      <RouterLink
        v-for="tile in queueTiles"
        :key="tile.key"
        :to="tile.to"
        class="bs-card p-4 no-underline text-inherit hover:shadow-md transition-shadow flex flex-col gap-3"
      >
        <div class="flex items-start justify-between gap-2">
          <span
            class="inline-flex h-9 w-9 items-center justify-center rounded-full shrink-0"
            :style="tile.chipStyle"
          >
            <i :class="['pi', tile.icon]"></i>
          </span>
          <span class="text-3xl font-bold leading-none" :style="tile.countStyle">
            {{ tile.count }}
          </span>
        </div>
        <div class="text-sm font-medium">{{ tile.label }}</div>
      </RouterLink>
    </div>

    <!-- Management areas — tools without an actionable count. -->
    <h2 class="text-base font-semibold mb-3">Manage</h2>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
      <RouterLink
        v-for="tile in manageTiles"
        :key="tile.to"
        :to="tile.to"
        class="bs-card p-4 no-underline text-inherit hover:shadow-md transition-shadow flex items-center gap-3"
      >
        <span
          class="inline-flex h-9 w-9 items-center justify-center rounded-full shrink-0"
          style="background-color: var(--bs-surface-alt); color: var(--bs-blue)"
        >
          <i :class="['pi', tile.icon]"></i>
        </span>
        <div class="min-w-0">
          <div class="text-sm font-medium truncate">{{ tile.label }}</div>
          <div class="text-xs text-[color:var(--bs-muted)] truncate">{{ tile.desc }}</div>
        </div>
      </RouterLink>
    </div>

    <!-- Platform at a glance — read-only marketing snapshot (platformStats doc,
         shared with /pitch). Dashes until the scheduled function's first run. -->
    <div class="bs-card p-5 mb-8">
      <h2 class="text-base font-semibold">Platform at a glance</h2>
      <div class="grid grid-cols-3 gap-4 mt-3">
        <div v-for="s in platformStats" :key="s.label">
          <div class="text-2xl font-bold">{{ s.value ?? "—" }}</div>
          <div class="text-xs text-[color:var(--bs-muted)]">{{ s.label }}</div>
        </div>
      </div>
    </div>

    <!-- Pending vetting — the daily triage surface. Tap an applicant to review. -->
    <div class="flex items-baseline justify-between mb-3">
      <h2 class="text-base font-semibold">Pending vetting</h2>
      <RouterLink
        v-if="pending.length"
        to="/admin/vetting"
        class="text-sm text-[color:var(--bs-blue)] no-underline hover:underline"
      >
        Full queue
      </RouterLink>
    </div>

    <LoadingState v-if="loading" />
    <div v-else-if="pending.length === 0" class="bs-empty">
      <i class="pi pi-check-circle text-3xl mb-2 block text-[color:var(--bs-success)]"></i>
      <p>Queue clear. Nice work.</p>
    </div>
    <div v-else class="space-y-3">
      <RouterLink
        v-for="t in pending"
        :key="t.id"
        :to="{ name: 'AdminApplication', params: { uid: t.id } }"
        class="bs-card p-4 flex items-center gap-3 no-underline text-inherit hover:shadow-md"
      >
        <Avatar
          v-if="t.photoURL"
          :image="t.photoURL"
          size="large"
          shape="circle"
        />
        <Avatar
          v-else
          :label="initialOf(t)"
          size="large"
          shape="circle"
          style="background-color: var(--bs-blue); color: white; font-weight: 600;"
        />
        <div class="min-w-0 flex-1">
          <div class="font-semibold truncate">{{ nameOf(t) }}</div>
          <div v-if="t.companyName" class="text-xs text-[color:var(--bs-muted)] truncate">
            {{ t.companyName }}
          </div>
          <div class="text-xs text-[color:var(--bs-muted)] truncate">
            {{ t.trades.map(tradeLabel).join(" • ") || "—" }} · Submitted {{ relativeTime(t.submittedAt) }}
          </div>
        </div>
        <i class="pi pi-chevron-right text-[color:var(--bs-muted)]"></i>
      </RouterLink>
    </div>
  </section>
</template>
