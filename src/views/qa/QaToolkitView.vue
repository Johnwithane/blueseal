<script setup lang="ts">
// Self-serve QA toolkit (/qa). Lets a tester holding the qa capability stand up
// their own test state without admin power: read the happy-paths runbook,
// provision an approved tradesperson profile, toggle their own Pro, reset their
// data, grab Stripe sandbox cards, jump to key flows, and review their bug
// reports + the shared error-log queue. May use Pinia (unlike admin views).
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

// --- Happy-paths runbook → one accordion panel per "## " section ----------
interface PathSection {
  label: string;
  body: string;
}
const pathSections = computed<PathSection[]>(() =>
  qaHappyPathsMd
    .split(/\n(?=## )/g)
    .filter((p) => p.startsWith("## "))
    .map((p) => {
      const nl = p.indexOf("\n");
      const rawTitle = (nl < 0 ? p.slice(3) : p.slice(3, nl)).trim();
      const label = rawTitle.split("→")[0].trim();
      const body = (nl < 0 ? "" : p.slice(nl + 1))
        .replace(/\n-{3,}\s*$/, "")
        .trim();
      return { label, body };
    }),
);
// Single-open accordion: only one path expanded at a time, all collapsed at first.
const openPath = ref<number | null>(null);
function togglePath(i: number) {
  openPath.value = openPath.value === i ? null : i;
}

// --- Stripe sandbox test cards -------------------------------------------
const STRIPE_CARDS: { number: string; result: string }[] = [
  { number: "4242 4242 4242 4242", result: "Payment succeeds" },
  { number: "4000 0000 0000 0002", result: "Card declined" },
  { number: "4000 0000 0000 9995", result: "Declined — insufficient funds" },
  { number: "4000 0027 6000 3184", result: "3-D Secure challenge" },
];
async function copyCard(num: string) {
  try {
    await navigator.clipboard.writeText(num.replace(/\s/g, ""));
    toast.success("Copied", `${num} copied to clipboard.`);
  } catch {
    /* clipboard may be blocked — non-fatal */
  }
}

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
  <section class="bs-container max-w-3xl py-6">
    <h1 class="text-xl font-bold text-[color:var(--bs-blue-dark)]">QA toolkit</h1>
    <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
      Self-serve test setup. Everything here acts only on your own account.
    </p>

    <!-- Happy paths (accordion) -->
    <div class="qa-card mt-5">
      <div class="qa-head"><i class="pi pi-list-check" aria-hidden="true"></i>Happy paths (QA runbook)</div>
      <div class="qa-body">
        <p class="qa-hint">Pick a flow to expand it — one at a time. Then use “Jump to a flow” below to start it.</p>
        <ul>
          <li v-for="(s, i) in pathSections" :key="i" class="qa-path-item">
            <button
              type="button"
              class="qa-path-head"
              :class="{ open: openPath === i }"
              @click="togglePath(i)"
            >
              <span>{{ s.label }}</span>
              <i :class="['pi', openPath === i ? 'pi-chevron-up' : 'pi-chevron-down']" aria-hidden="true"></i>
            </button>
            <div v-if="openPath === i" class="qa-path-body qa-runbook">
              <MarkdownProse :source="s.body" />
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Stripe sandbox -->
    <div class="qa-card mt-4">
      <div class="qa-head"><i class="pi pi-credit-card" aria-hidden="true"></i>Stripe sandbox (test mode)</div>
      <div class="qa-body">
        <p class="qa-hint">
          Test mode — no real charges. Use any future expiry, any CVC, any postal code.
          Tap a card to copy it.
        </p>
        <ul class="space-y-2">
          <li
            v-for="c in STRIPE_CARDS"
            :key="c.number"
            class="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--bs-border)] p-2"
          >
            <div class="min-w-0">
              <code class="font-semibold">{{ c.number }}</code>
              <span class="ml-2 text-xs text-[color:var(--bs-muted)]">{{ c.result }}</span>
            </div>
            <Button icon="pi pi-copy" size="small" text aria-label="Copy card number" @click="copyCard(c.number)" />
          </li>
        </ul>
      </div>
    </div>

    <!-- Provision as tradesperson -->
    <div class="qa-card mt-4">
      <div class="qa-head"><i class="pi pi-verified" aria-hidden="true"></i>Become an approved tradesperson</div>
      <div class="qa-body">
        <p class="qa-hint">
          Pick the trades to test. This approves + verifies you instantly so you appear in search
          and can browse the job board (no vetting wait).
        </p>
        <div class="flex flex-wrap items-center gap-3">
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
    </div>

    <!-- Toggle Pro -->
    <div class="qa-card mt-4">
      <div class="qa-head"><i class="pi pi-star" aria-hidden="true"></i>Blue Seal Pro</div>
      <div class="qa-body">
        <p class="qa-hint">
          Flip your own Pro entitlement to test free vs Pro (AI tools, client fee waiver). No Stripe.
          <span v-if="isPro !== null" class="font-medium text-[color:var(--bs-text)]">Currently: {{ isPro ? "Pro" : "Free" }}.</span>
        </p>
        <div class="flex flex-wrap gap-2">
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
    </div>

    <!-- Reset my data -->
    <div class="qa-card mt-4">
      <div class="qa-head"><i class="pi pi-trash" aria-hidden="true"></i>Reset my data</div>
      <div class="qa-body">
        <p class="qa-hint">
          Delete your own jobs, job posts and applications, and set your tradesperson profile back to
          draft — so you can re-run a flow clean.
        </p>
        <div v-if="!confirmingReset">
          <Button label="Reset my data" icon="pi pi-trash" severity="danger" outlined @click="confirmingReset = true" />
        </div>
        <div v-else class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium">This can't be undone. Continue?</span>
          <Button label="Yes, reset" severity="danger" :loading="resetting" @click="resetData" />
          <Button label="Cancel" text :disabled="resetting" @click="confirmingReset = false" />
        </div>
      </div>
    </div>

    <!-- Quick links -->
    <div class="qa-card mt-4">
      <div class="qa-head"><i class="pi pi-directions" aria-hidden="true"></i>Jump to a flow</div>
      <div class="qa-body">
        <div class="flex flex-wrap gap-2">
          <RouterLink to="/dashboard/client"><Button label="Client dashboard" icon="pi pi-home" outlined size="small" /></RouterLink>
          <RouterLink to="/dashboard/tradie"><Button label="Tradesperson dashboard" icon="pi pi-wrench" outlined size="small" /></RouterLink>
          <RouterLink to="/jobs/browse"><Button label="Browse jobs" icon="pi pi-search" outlined size="small" /></RouterLink>
          <RouterLink to="/jobs/post"><Button label="Post a job" icon="pi pi-plus" outlined size="small" /></RouterLink>
          <RouterLink to="/search"><Button label="Search tradespeople" icon="pi pi-users" outlined size="small" /></RouterLink>
          <RouterLink v-if="auth.hasAdminRole" to="/admin/bug-reports"><Button label="Bug triage (admin)" icon="pi pi-bug" outlined size="small" /></RouterLink>
        </div>
      </div>
    </div>

    <!-- Error log -->
    <div class="qa-card mt-4">
      <div class="qa-head">
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>Error log ({{ openErrors.length }} open)
        <Button label="Refresh" icon="pi pi-refresh" text size="small" class="ml-auto qa-head-btn" :loading="loadingErrors" @click="loadErrors" />
      </div>
      <div class="qa-body">
        <p class="qa-hint">Runtime errors captured automatically across all sessions. Resolve once handled.</p>
        <ul v-if="openErrors.length" class="space-y-2">
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
        <p v-else class="text-sm text-[color:var(--bs-muted)]">No open errors.</p>
      </div>
    </div>

    <!-- My bug reports -->
    <div class="qa-card mt-4 mb-6">
      <div class="qa-head"><i class="pi pi-bug" aria-hidden="true"></i>My bug reports</div>
      <div class="qa-body">
        <p class="qa-hint">
          Use the red “Report a bug” button (bottom-left) anywhere in the app — paste a screenshot
          to attach it. Device + page details are captured automatically.
        </p>
        <ul v-if="myReports.length" class="space-y-2">
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
        <p v-else class="text-sm text-[color:var(--bs-muted)]">No bug reports yet.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.qa-card {
  border: 1px solid var(--bs-border);
  border-radius: 0.75rem;
  overflow: hidden;
  background: #fff;
}
.qa-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bs-blue-dark);
  color: #fff;
  padding: 0.7rem 0.95rem;
  font-weight: 600;
  font-size: 0.95rem;
}
.qa-head :deep(.qa-head-btn .p-button-label),
.qa-head :deep(.qa-head-btn) {
  color: #fff;
}
.qa-body {
  padding: 1rem 0.95rem;
}
.qa-hint {
  font-size: 0.8rem;
  color: var(--bs-muted);
  margin-bottom: 0.6rem;
  line-height: 1.5;
}

/* Happy-paths accordion */
.qa-path-item {
  margin-bottom: 0.4rem;
}
.qa-path-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  border: 0;
  cursor: pointer;
  background: var(--bs-blue);
  color: #fff;
  font-weight: 600;
  font-size: 0.875rem;
  text-align: left;
  border-radius: 0.5rem;
}
.qa-path-head.open {
  border-radius: 0.5rem 0.5rem 0 0;
}
.qa-path-head:hover {
  filter: brightness(1.06);
}
.qa-path-body {
  border: 1px solid var(--bs-border);
  border-top: 0;
  border-radius: 0 0 0.5rem 0.5rem;
  padding: 0.25rem 0.85rem 0.5rem;
}

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
