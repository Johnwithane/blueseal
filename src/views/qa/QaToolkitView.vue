<script setup lang="ts">
// Self-serve QA toolkit (/qa). Lets a tester holding the qa capability stand up
// their own test state without admin power: provision an approved tradesperson
// profile on chosen trades, toggle their own Blue Seal Pro, reset their data
// between runs, jump to the key flows, and review their bug reports + the shared
// error-log queue. May use Pinia (unlike the admin views) — it's a normal app
// surface under the app shell, gated to the qa role by the router.
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import MultiSelect from "primevue/multiselect";
import Tag from "primevue/tag";
import Message from "primevue/message";
import MarkdownProse from "@/components/help/MarkdownProse.vue";
import { TRADES } from "@/data/trades";
import qaHappyPathsMd from "../../../docs/QA_HAPPY_PATHS.md?raw";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import {
  qaProvisionSelfTradesperson,
  qaSetSelfPro,
  qaResetSelfData,
} from "@/firebase/services/qa";
import { listMyBugReports } from "@/firebase/services/bugReports";
import { listErrorLogs, setErrorResolved } from "@/firebase/services/errorReporting";
import type { BugReportDoc, ErrorLogDoc, WithId } from "@/firebase/interfaces";

const auth = useAuthStore();
const toast = useToast();
const { relativeTime } = useFormatters();

// Inline happy-paths runbook (single source: docs/QA_HAPPY_PATHS.md). Collapsed
// by default since it's long, but kept right at the top so testers can follow a
// flow without leaving the toolkit.
const showRunbook = ref(false);

// --- Provision as tradesperson -------------------------------------------
const selectedTrades = ref<string[]>([]);
const provisioning = ref(false);
const provisionDone = ref<string[] | null>(null);

async function provision() {
  if (selectedTrades.value.length === 0) {
    toast.error("Pick a trade", "Choose at least one trade to provision.");
    return;
  }
  provisioning.value = true;
  try {
    const res = await qaProvisionSelfTradesperson({ trades: selectedTrades.value });
    // Surface the new claims (tradesperson + qa) to the session immediately.
    await auth.fbUser?.getIdToken(true);
    auth.roles = res.data.roles;
    provisionDone.value = res.data.trades;
    toast.success(
      "Provisioned",
      "You're an approved tradesperson now. Switch to Tradesperson view to browse jobs.",
    );
  } catch (e) {
    toast.error("Couldn't provision", humanizeError(e));
  } finally {
    provisioning.value = false;
  }
}

// --- Toggle Pro ----------------------------------------------------------
const settingPro = ref(false);
const isPro = ref<boolean | null>(null);

async function setPro(pro: boolean) {
  settingPro.value = true;
  try {
    const res = await qaSetSelfPro({ pro });
    isPro.value = res.data.isPro;
    await auth.fbUser?.getIdToken(true);
    toast.success(pro ? "Pro enabled" : "Pro disabled", `You are now ${res.data.isPro ? "Pro" : "Free"}.`);
  } catch (e) {
    toast.error("Couldn't change Pro", humanizeError(e));
  } finally {
    settingPro.value = false;
  }
}

// --- Reset my data -------------------------------------------------------
const confirmingReset = ref(false);
const resetting = ref(false);

async function resetData() {
  resetting.value = true;
  try {
    const res = await qaResetSelfData({});
    const d = res.data.deleted;
    toast.success(
      "Reset done",
      `Removed ${d.jobs} job(s), ${d.jobPosts} post(s), ${d.applications} application(s).`,
    );
    confirmingReset.value = false;
    await loadMyReports();
  } catch (e) {
    toast.error("Couldn't reset", humanizeError(e));
  } finally {
    resetting.value = false;
  }
}

// --- My bug reports ------------------------------------------------------
const myReports = ref<WithId<BugReportDoc>[]>([]);
async function loadMyReports() {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  try {
    myReports.value = await listMyBugReports(uid);
  } catch {
    /* index may not be live on first deploy — non-fatal */
  }
}

// --- Error log (shared diagnostics queue; qa + admin) --------------------
const errors = ref<WithId<ErrorLogDoc>[]>([]);
const loadingErrors = ref(false);
async function loadErrors() {
  loadingErrors.value = true;
  try {
    errors.value = await listErrorLogs();
  } catch (e) {
    toast.error("Couldn't load error log", humanizeError(e));
  } finally {
    loadingErrors.value = false;
  }
}
const openErrors = computed(() => errors.value.filter((e) => !e.resolved));

async function resolveError(id: string) {
  try {
    await setErrorResolved(id, true);
    const hit = errors.value.find((e) => e.id === id);
    if (hit) hit.resolved = true;
  } catch (e) {
    toast.error("Couldn't resolve", humanizeError(e));
  }
}

onMounted(() => {
  void loadMyReports();
  void loadErrors();
});
</script>

<template>
  <section class="bs-container py-6">
    <h1 class="text-lg font-semibold text-[color:var(--bs-blue-dark)]">QA toolkit</h1>
    <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
      Self-serve test setup. Everything here acts only on your own account.
    </p>

    <!-- Happy-paths runbook, inline so testers can follow a flow without leaving -->
    <div class="bs-card mt-5 p-5">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-base font-semibold">Happy paths (QA runbook)</h2>
        <Button
          :label="showRunbook ? 'Hide' : 'Show'"
          :icon="showRunbook ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
          text
          size="small"
          @click="showRunbook = !showRunbook"
        />
      </div>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        The step-by-step flows to test — open one, then use the quick links below
        (Jump to a flow) to start it.
      </p>
      <div v-if="showRunbook" class="qa-runbook mt-3">
        <MarkdownProse :source="qaHappyPathsMd" />
      </div>
    </div>

    <!-- Provision as tradesperson -->
    <div class="bs-card mt-5 p-5">
      <h2 class="text-base font-semibold">Become an approved tradesperson</h2>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        Pick the trades to test. This approves + verifies you instantly so you appear in search
        and can browse the job board (no vetting wait).
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <MultiSelect
          v-model="selectedTrades"
          :options="TRADES"
          option-label="label"
          option-value="key"
          filter
          display="chip"
          placeholder="Select trades"
          class="w-full sm:w-96"
        />
        <Button
          label="Provision me"
          icon="pi pi-verified"
          :loading="provisioning"
          :disabled="selectedTrades.length === 0"
          @click="provision"
        />
      </div>
      <Message v-if="provisionDone" severity="success" :closable="false" class="mt-3">
        Approved on: {{ provisionDone.join(", ") }}. Switch to Tradesperson view to browse jobs.
      </Message>
    </div>

    <!-- Toggle Pro -->
    <div class="bs-card mt-4 p-5">
      <h2 class="text-base font-semibold">Blue Seal Pro</h2>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        Flip your own Pro entitlement to test free vs Pro (AI tools, client fee waiver). No Stripe.
        <span v-if="isPro !== null" class="font-medium">Currently: {{ isPro ? "Pro" : "Free" }}.</span>
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button label="Enable Pro" icon="pi pi-star" :loading="settingPro" @click="setPro(true)" />
        <Button
          label="Disable Pro"
          icon="pi pi-star-fill"
          severity="secondary"
          outlined
          :loading="settingPro"
          @click="setPro(false)"
        />
      </div>
    </div>

    <!-- Reset my data -->
    <div class="bs-card mt-4 p-5">
      <h2 class="text-base font-semibold">Reset my data</h2>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        Delete your own jobs, job posts and applications, and set your tradesperson profile back to
        draft — so you can re-run a flow clean.
      </p>
      <div v-if="!confirmingReset" class="mt-3">
        <Button label="Reset my data" icon="pi pi-trash" severity="danger" outlined @click="confirmingReset = true" />
      </div>
      <div v-else class="mt-3 flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium">This can't be undone. Continue?</span>
        <Button label="Yes, reset" severity="danger" :loading="resetting" @click="resetData" />
        <Button label="Cancel" text :disabled="resetting" @click="confirmingReset = false" />
      </div>
    </div>

    <!-- Quick links -->
    <div class="bs-card mt-4 p-5">
      <h2 class="text-base font-semibold">Jump to a flow</h2>
      <div class="mt-3 flex flex-wrap gap-2">
        <RouterLink to="/dashboard/client"><Button label="Client dashboard" icon="pi pi-home" outlined size="small" /></RouterLink>
        <RouterLink to="/dashboard/tradie"><Button label="Tradesperson dashboard" icon="pi pi-wrench" outlined size="small" /></RouterLink>
        <RouterLink to="/jobs/browse"><Button label="Browse jobs" icon="pi pi-search" outlined size="small" /></RouterLink>
        <RouterLink to="/jobs/post"><Button label="Post a job" icon="pi pi-plus" outlined size="small" /></RouterLink>
        <RouterLink to="/search"><Button label="Search tradespeople" icon="pi pi-users" outlined size="small" /></RouterLink>
        <RouterLink v-if="auth.hasAdminRole" to="/admin/bug-reports"><Button label="Bug triage (admin)" icon="pi pi-bug" outlined size="small" /></RouterLink>
      </div>
    </div>

    <!-- Error log (shared queue) -->
    <div class="bs-card mt-4 p-5">
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold">Error log ({{ openErrors.length }} open)</h2>
        <Button label="Refresh" icon="pi pi-refresh" text size="small" :loading="loadingErrors" @click="loadErrors" />
      </div>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        Runtime errors captured automatically across all sessions. Resolve once handled.
      </p>
      <ul v-if="openErrors.length" class="mt-3 space-y-2">
        <li
          v-for="e in openErrors.slice(0, 25)"
          :key="e.id"
          class="rounded-lg border border-[color:var(--bs-border)] p-3 text-sm"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-medium">{{ e.message }}</div>
              <div class="mt-0.5 text-xs text-[color:var(--bs-muted)]">
                <Tag :value="e.source" severity="secondary" class="mr-1" />
                {{ e.route || "—" }} · {{ relativeTime(e.createdAt) }}
              </div>
            </div>
            <Button label="Resolve" size="small" text @click="resolveError(e.id)" />
          </div>
        </li>
      </ul>
      <p v-else class="mt-3 text-sm text-[color:var(--bs-muted)]">No open errors.</p>
    </div>

    <!-- My bug reports -->
    <div class="bs-card mt-4 p-5">
      <h2 class="text-base font-semibold">My bug reports</h2>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        Use the floating "Report a bug" button (bottom-right) anywhere in the app — paste a
        screenshot to attach it.
      </p>
      <ul v-if="myReports.length" class="mt-3 space-y-2">
        <li
          v-for="r in myReports"
          :key="r.id"
          class="flex items-center justify-between rounded-lg border border-[color:var(--bs-border)] p-3 text-sm"
        >
          <span class="min-w-0 truncate font-medium">{{ r.title }}</span>
          <span class="flex items-center gap-2">
            <Tag :value="r.severity" severity="secondary" />
            <Tag :value="r.status" />
            <span class="text-xs text-[color:var(--bs-muted)]">{{ relativeTime(r.createdAt) }}</span>
          </span>
        </li>
      </ul>
      <p v-else class="mt-3 text-sm text-[color:var(--bs-muted)]">No bug reports yet.</p>
    </div>
  </section>
</template>

<style scoped>
/* MarkdownProse doesn't style tables/checkboxes; the runbook uses both. */
.qa-runbook :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1rem;
  font-size: 0.875rem;
}
.qa-runbook :deep(th),
.qa-runbook :deep(td) {
  border: 1px solid var(--bs-border);
  padding: 0.4rem 0.6rem;
  text-align: left;
}
.qa-runbook :deep(li) {
  line-height: 1.6;
}
</style>
