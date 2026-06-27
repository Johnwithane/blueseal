<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import { useFormatters } from "@/composables";
import { subscribeProperties } from "@/firebase/services/properties";
import { subscribeProjectsForPm } from "@/firebase/services/projects";
import { subscribeProjectJobsForPm } from "@/firebase/services/jobs";
import { subscribeSavedTradieIds } from "@/firebase/services/savedTradies";
import { usePmEarnings } from "@/composables/usePmEarnings";
import { PM_AGREEMENT_VERSION } from "@/projectManager/agreement";
import { tradeLabel } from "@/data/trades";
import type { JobDoc, ProjectDoc, PropertyDoc, WithId } from "@/firebase/interfaces";

// The PM cockpit HOME: an at-a-glance overview. The working surfaces (Properties,
// Jobs, Trades, Earnings, Profile) are their own nav destinations now; this page
// orients + routes into them.
const auth = useAuthStore();
const { money } = useFormatters();
const { summary } = usePmEarnings();
useSeo({ title: "Dashboard", noindex: true });

const firstName = computed(() => (auth.user?.displayName ?? "").trim().split(/\s+/)[0] || "");

const properties = ref<WithId<PropertyDoc>[]>([]);
const projects = ref<WithId<ProjectDoc>[]>([]);
const jobs = ref<WithId<JobDoc>[]>([]);
const rosterCount = ref(0);
const unsubs: Array<() => void> = [];

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  unsubs.push(subscribeProperties(uid, (p) => (properties.value = p)));
  unsubs.push(subscribeProjectsForPm(uid, (p) => (projects.value = p)));
  unsubs.push(subscribeProjectJobsForPm(uid, (j) => (jobs.value = j)));
  unsubs.push(subscribeSavedTradieIds(uid, (ids) => (rosterCount.value = ids.size)));
});
onUnmounted(() => unsubs.forEach((u) => u()));

const activeProjects = computed(() =>
  projects.value.filter((p) => p.status !== "declined" && p.status !== "cancelled"),
);
const jobsInProgress = computed(() => jobs.value.filter((j) => j.status === "in_progress").length);
// Surface live work, not cancelled/declined dead rows (which the stat tile excludes).
const recentProjects = computed(() => activeProjects.value.slice(0, 4));

// First-run guidance: a brand-new PM with an empty cockpit needs an ordered nudge.
// The order matters — adding trusted trades FIRST is what makes a project dispatch
// to *their* trades; create a project with an empty roster and the jobs fall through
// to the public board, which defeats the whole "refer my trades" pitch. We hide the
// card once they're activated (≥1 saved trade AND ≥1 project); a property is
// recommended but optional (a project can stand on its own), so it doesn't gate.
const setupSteps = computed(() => [
  {
    key: "trades",
    done: rosterCount.value > 0,
    label: "Add your trusted trades",
    hint: "Do this first — projects go out to the trades on your roster.",
    to: "/manage/trades",
    cta: "Add trades",
  },
  {
    key: "property",
    done: properties.value.length > 0,
    label: "Add a property",
    hint: "Organise work by address (optional, but keeps multi-job clients tidy).",
    to: "/manage/properties",
    cta: "Add a property",
  },
  {
    key: "project",
    done: projects.value.length > 0,
    label: "Set up your first project",
    hint: "Bundle the jobs for a client and invite them to choose their trades.",
    to: "/manage/properties?new=1",
    cta: "New project",
  },
]);
const setupDoneCount = computed(() => setupSteps.value.filter((s) => s.done).length);
const showGettingStarted = computed(() => rosterCount.value === 0 || projects.value.length === 0);

// Payout setup nudge: shown until the PM has signed the current agreement AND
// connected Stripe payouts.
const payoutsReady = computed(
  () =>
    auth.user?.projectManager?.liability?.version === PM_AGREEMENT_VERSION &&
    auth.user?.projectManager?.payouts?.payoutsEnabled === true,
);

const projectStatusSeverity: Record<string, "info" | "warn" | "success" | "secondary"> = {
  invited: "info",
  claimed: "warn",
  accepted: "success",
  declined: "secondary",
  cancelled: "secondary",
};
const projectStatusLabel: Record<string, string> = {
  invited: "Invite sent",
  claimed: "Client joined",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <div class="bs-pill verified mb-3">
      <i class="pi pi-briefcase"></i>
      <span>Project manager</span>
    </div>
    <h1 class="text-2xl font-bold">
      Welcome<template v-if="firstName">, {{ firstName }}</template>.
    </h1>
    <p class="text-[color:var(--bs-muted)] mb-6 max-w-prose">
      Your command centre. Set up work for clients across your properties, refer the trades you
      trust, and track everything in one place.
    </p>

    <!-- First-run checklist: an ordered nudge for a new PM, hidden once activated. -->
    <div v-if="showGettingStarted" class="bs-card p-4 mb-6">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-lg font-bold">Get started</h2>
        <span class="text-sm text-[color:var(--bs-muted)]">{{ setupDoneCount }}/3 done</span>
      </div>
      <ul class="mt-3 space-y-2">
        <li
          v-for="step in setupSteps"
          :key="step.key"
          class="flex items-start gap-3 rounded-lg p-2"
          :class="step.done ? 'opacity-60' : 'bg-[color:var(--bs-surface-alt)]'"
        >
          <i
            class="pi mt-0.5 text-lg"
            :class="step.done
              ? 'pi-check-circle text-[color:var(--bs-success)]'
              : 'pi-circle text-[color:var(--bs-muted)]'"
          ></i>
          <div class="min-w-0 flex-1">
            <p class="font-medium" :class="step.done ? 'line-through' : ''">{{ step.label }}</p>
            <p v-if="!step.done" class="text-xs text-[color:var(--bs-muted)]">{{ step.hint }}</p>
          </div>
          <RouterLink v-if="!step.done" :to="step.to" class="shrink-0">
            <Button :label="step.cta" size="small" outlined />
          </RouterLink>
        </li>
      </ul>
    </div>

    <!-- Stat tiles -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <RouterLink to="/manage/properties" class="bs-card p-4 no-underline text-inherit hover:shadow-md transition-shadow">
        <div class="text-2xl font-bold">{{ properties.length }}</div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">Properties</div>
      </RouterLink>
      <RouterLink to="/manage/properties" class="bs-card p-4 no-underline text-inherit hover:shadow-md transition-shadow">
        <div class="text-2xl font-bold">{{ activeProjects.length }}</div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">Active projects</div>
      </RouterLink>
      <RouterLink to="/manage/jobs" class="bs-card p-4 no-underline text-inherit hover:shadow-md transition-shadow">
        <div class="text-2xl font-bold">{{ jobsInProgress }}</div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">Jobs in progress</div>
      </RouterLink>
      <RouterLink to="/manage/earnings" class="bs-card p-4 no-underline text-inherit hover:shadow-md transition-shadow">
        <div class="text-2xl font-bold">{{ money(summary.unpaidCents) }}</div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">Unpaid earnings</div>
      </RouterLink>
    </div>

    <!-- Quick actions -->
    <div class="flex flex-wrap gap-2 mt-5">
      <RouterLink to="/manage/properties?new=1"><Button label="New project" icon="pi pi-plus" size="small" /></RouterLink>
      <RouterLink to="/manage/trades"><Button label="My roster" icon="pi pi-users" size="small" outlined /></RouterLink>
      <RouterLink to="/manage/card"><Button label="My business card" icon="pi pi-id-card" size="small" severity="secondary" outlined /></RouterLink>
      <RouterLink to="/manage/profile"><Button label="Share my profile" icon="pi pi-link" size="small" severity="secondary" outlined /></RouterLink>
    </div>

    <!-- Payout nudge -->
    <RouterLink
      v-if="!payoutsReady"
      to="/manage/earnings"
      class="block bs-card p-4 mt-5 no-underline text-inherit border border-[color:var(--bs-warning)] hover:shadow-md transition-shadow"
    >
      <div class="flex items-start gap-2">
        <i class="pi pi-wallet text-[color:var(--bs-warning-text,#92600b)] mt-0.5"></i>
        <div>
          <p class="font-medium">Set up payouts to get paid</p>
          <p class="text-sm text-[color:var(--bs-muted)]">
            Sign the agreement and connect your bank so your commission pays out each month.
          </p>
        </div>
      </div>
    </RouterLink>

    <!-- Recent projects -->
    <div class="flex items-center justify-between mt-8 mb-2">
      <h2 class="text-lg font-bold">Recent projects</h2>
      <RouterLink to="/manage/properties" class="text-sm text-[color:var(--bs-blue)] no-underline">View all</RouterLink>
    </div>
    <div v-if="recentProjects.length === 0" class="bs-card p-6 text-center">
      <i class="pi pi-folder-open text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">No projects yet</p>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Add a property, then set up a project for your client and send it to your trades for quotes.
      </p>
      <RouterLink to="/manage/properties" class="inline-block mt-3">
        <Button label="Go to properties" icon="pi pi-home" size="small" />
      </RouterLink>
    </div>
    <ul v-else class="grid grid-cols-1 gap-2">
      <li v-for="p in recentProjects" :key="p.id">
        <RouterLink
          :to="{ name: 'ProjectDetail', params: { projectId: p.id } }"
          class="bs-card p-3 flex items-center gap-3 no-underline text-inherit hover:shadow-md transition-shadow"
        >
          <img v-if="p.photoUrl" :src="p.photoUrl" alt="" class="h-10 w-10 rounded object-cover shrink-0" />
          <i v-else class="pi pi-folder-open text-[color:var(--bs-blue)]"></i>
          <div class="min-w-0 flex-1">
            <p class="font-medium truncate">{{ p.label }}</p>
            <p class="text-xs text-[color:var(--bs-muted)] truncate">
              {{ p.clientName }} · {{ p.jobSpecs.length }} {{ p.jobSpecs.length === 1 ? "job" : "jobs" }}
              <template v-if="p.jobSpecs.length">
                ({{ p.jobSpecs.map((j) => tradeLabel(j.trade)).join(", ") }})
              </template>
            </p>
          </div>
          <Tag :value="projectStatusLabel[p.status] ?? p.status" :severity="projectStatusSeverity[p.status] ?? 'info'" />
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
