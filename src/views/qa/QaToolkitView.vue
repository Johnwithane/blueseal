<script setup lang="ts">
// Self-serve QA toolkit (/qa). Lets a tester holding the qa capability stand up
// their own test state without admin power: read the happy-paths runbook,
// provision an approved tradesperson profile, toggle their own Pro, reset their
// data, grab Stripe sandbox cards, jump to key flows, and review their bug
// reports + the shared error-log queue. May use Pinia (unlike admin views).
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
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
  qaProvisionSelfProjectManager,
  qaProvisionSelfSalesRep,
  qaSetSelfPro,
  qaResetSelfData,
} from "@/firebase/services/qa";
import { listMyBugReports } from "@/firebase/services/bugReports";
import { listErrorLogs, setErrorResolved } from "@/firebase/services/errorReporting";
import type { BugReportDoc, ErrorLogDoc, WithId } from "@/firebase/interfaces";

const auth = useAuthStore();
const toast = useToast();
const router = useRouter();
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
// The whole runbook collapses; inside it, only one path is open at a time.
const showPaths = ref(false);
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

// --- Become a project manager / sales rep --------------------------------
const provisioningRole = ref<null | "pm" | "sales">(null);

async function becomeProjectManager() {
  provisioningRole.value = "pm";
  try {
    const res = await qaProvisionSelfProjectManager({});
    await auth.fbUser?.getIdToken(true);
    auth.roles = res.data.roles;
    await auth.switchActiveRole("projectManager").catch(() => {});
    toast.success("You're a project manager", "Opening your cockpit…");
    router.push("/manage");
  } catch (e) {
    toast.error("Couldn't provision", humanizeError(e));
  } finally {
    provisioningRole.value = null;
  }
}

async function becomeSalesRep() {
  provisioningRole.value = "sales";
  try {
    const res = await qaProvisionSelfSalesRep({});
    await auth.fbUser?.getIdToken(true);
    auth.roles = res.data.roles;
    await auth.switchActiveRole("sales").catch(() => {});
    toast.success("You're a sales rep", "Sign the agreement to start, then open /sales.");
    router.push("/sales");
  } catch (e) {
    toast.error("Couldn't provision", humanizeError(e));
  } finally {
    provisioningRole.value = null;
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
    <p class="text-sm text-[color:var(--bs-muted)]">
      Self-serve test setup. Everything here acts only on your own account.
    </p>

    <!-- Happy paths — distinct "hero" card; the whole runbook collapses. -->
    <div class="qa-card qa-card--hero mt-4">
      <button
        type="button"
        class="qa-head qa-head--hero"
        :aria-expanded="showPaths"
        @click="showPaths = !showPaths"
      >
        <i class="pi pi-book" aria-hidden="true"></i>
        <span>Happy paths (QA runbook)</span>
        <i
          :class="['pi', showPaths ? 'pi-chevron-up' : 'pi-chevron-down', 'qa-head__chev']"
          aria-hidden="true"
        ></i>
      </button>
      <div v-if="showPaths" class="qa-body">
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

    <!-- Setup / reference / diagnostics, as tiles (2-col on desktop). Paired by
         rough height so the grid stays tidy. -->
    <div class="grid gap-4 mt-4 sm:grid-cols-2 items-start">
      <!-- Become a tradesperson -->
      <div class="qa-card">
        <div class="qa-head"><i class="pi pi-verified" aria-hidden="true"></i>Become an approved tradesperson</div>
        <div class="qa-body">
          <p class="qa-hint">
            Pick the trades to test. This approves + verifies you instantly so you appear in search
            and can browse the job board (no vetting wait).
          </p>
          <MultiSelect
            v-model="selectedTrades"
            :options="TRADES"
            option-label="label"
            option-value="key"
            filter
            display="chip"
            placeholder="Select trades"
            class="w-full"
          />
          <div class="mt-2">
            <Button
              label="Provision me"
              icon="pi pi-verified"
              size="small"
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

      <!-- Become a project manager / sales rep -->
      <div class="qa-card">
        <div class="qa-head"><i class="pi pi-briefcase" aria-hidden="true"></i>Become a PM or sales rep</div>
        <div class="qa-body">
          <p class="qa-hint">
            Grant yourself the new roles to test them. The PM role is active instantly (opens
            <code>/manage</code>); the sales-rep role needs the in-app agreement signed first.
          </p>
          <div class="flex flex-wrap gap-2">
            <Button
              label="Become a project manager"
              icon="pi pi-briefcase"
              size="small"
              :loading="provisioningRole === 'pm'"
              :disabled="provisioningRole !== null"
              @click="becomeProjectManager"
            />
            <Button
              label="Become a sales rep"
              icon="pi pi-map-marker"
              severity="secondary"
              outlined
              size="small"
              :loading="provisioningRole === 'sales'"
              :disabled="provisioningRole !== null"
              @click="becomeSalesRep"
            />
          </div>
        </div>
      </div>

      <!-- Stripe sandbox -->
      <div class="qa-card">
        <div class="qa-head"><i class="pi pi-credit-card" aria-hidden="true"></i>Stripe sandbox (test mode)</div>
        <div class="qa-body">
          <p class="qa-hint">
            Test mode — no real charges. Any future expiry, any CVC, any postal. Tap to copy.
          </p>
          <ul class="space-y-2">
            <li
              v-for="c in STRIPE_CARDS"
              :key="c.number"
              class="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--bs-border)] p-2"
            >
              <div class="min-w-0">
                <code class="font-semibold">{{ c.number }}</code>
                <span class="block text-xs text-[color:var(--bs-muted)]">{{ c.result }}</span>
              </div>
              <Button icon="pi pi-copy" size="small" text aria-label="Copy card number" @click="copyCard(c.number)" />
            </li>
          </ul>
        </div>
      </div>

      <!-- Blue Seal Pro -->
      <div class="qa-card">
        <div class="qa-head"><i class="pi pi-star" aria-hidden="true"></i>Blue Seal Pro</div>
        <div class="qa-body">
          <p class="qa-hint">
            Flip your own Pro entitlement to test free vs Pro. No Stripe.
            <span v-if="isPro !== null" class="font-medium text-[color:var(--bs-text)]">Currently: {{ isPro ? "Pro" : "Free" }}.</span>
          </p>
          <div class="flex flex-wrap gap-2">
            <Button label="Enable Pro" icon="pi pi-star" size="small" :loading="settingPro" @click="setPro(true)" />
            <Button
              label="Disable Pro"
              icon="pi pi-star-fill"
              severity="secondary"
              outlined
              size="small"
              :loading="settingPro"
              @click="setPro(false)"
            />
          </div>
        </div>
      </div>

      <!-- Reset my data -->
      <div class="qa-card">
        <div class="qa-head"><i class="pi pi-trash" aria-hidden="true"></i>Reset my data</div>
        <div class="qa-body">
          <p class="qa-hint">
            Delete your own jobs, posts and applications, and set your profile back to draft.
          </p>
          <div v-if="!confirmingReset">
            <Button label="Reset my data" icon="pi pi-trash" severity="danger" outlined size="small" @click="confirmingReset = true" />
          </div>
          <div v-else class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">This can't be undone. Continue?</span>
            <Button label="Yes, reset" severity="danger" size="small" :loading="resetting" @click="resetData" />
            <Button label="Cancel" text size="small" :disabled="resetting" @click="confirmingReset = false" />
          </div>
        </div>
      </div>

      <!-- Jump to a flow -->
      <div class="qa-card">
        <div class="qa-head"><i class="pi pi-directions" aria-hidden="true"></i>Jump to a flow</div>
        <div class="qa-body">
          <div class="flex flex-wrap gap-2">
            <RouterLink to="/dashboard/client"><Button label="Client dashboard" icon="pi pi-home" outlined size="small" /></RouterLink>
            <RouterLink to="/dashboard/tradie"><Button label="Tradesperson" icon="pi pi-wrench" outlined size="small" /></RouterLink>
            <RouterLink to="/manage"><Button label="PM cockpit" icon="pi pi-briefcase" outlined size="small" /></RouterLink>
            <RouterLink to="/sales"><Button label="Sales" icon="pi pi-map-marker" outlined size="small" /></RouterLink>
            <RouterLink to="/jobs/browse"><Button label="Browse jobs" icon="pi pi-search" outlined size="small" /></RouterLink>
            <RouterLink to="/jobs/post"><Button label="Post a job" icon="pi pi-plus" outlined size="small" /></RouterLink>
            <RouterLink to="/search"><Button label="Search" icon="pi pi-users" outlined size="small" /></RouterLink>
            <RouterLink v-if="auth.hasAdminRole" to="/admin/bug-reports"><Button label="Bug triage" icon="pi pi-bug" outlined size="small" /></RouterLink>
          </div>
        </div>
      </div>

      <!-- Error log -->
      <div class="qa-card">
        <div class="qa-head">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>Error log ({{ openErrors.length }})
          <Button label="Refresh" icon="pi pi-refresh" text size="small" class="ml-auto qa-head-btn" :loading="loadingErrors" @click="loadErrors" />
        </div>
        <div class="qa-body">
          <p class="qa-hint">Runtime errors captured automatically across all sessions.</p>
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
            class="rounded-lg border border-[color:var(--bs-border)] text-sm"
          >
            <details class="qa-report">
              <summary class="flex cursor-pointer items-center justify-between gap-2 p-3">
                <span class="flex min-w-0 items-center gap-2">
                  <i
                    class="pi pi-chevron-right qa-report__chev text-xs text-[color:var(--bs-muted)]"
                    aria-hidden="true"
                  ></i>
                  <span class="min-w-0 truncate font-medium">{{ r.title }}</span>
                </span>
                <span class="flex shrink-0 items-center gap-2">
                  <Tag :value="r.severity" severity="secondary" />
                  <Tag :value="r.status" />
                  <span class="text-xs text-[color:var(--bs-muted)]">{{ relativeTime(r.createdAt) }}</span>
                </span>
              </summary>
              <dl class="space-y-2 border-t border-[color:var(--bs-border)] px-3 pb-3 pt-2">
                <div v-if="r.stepsToReproduce">
                  <dt class="text-xs font-semibold text-[color:var(--bs-muted)]">Steps to reproduce</dt>
                  <dd class="whitespace-pre-wrap">{{ r.stepsToReproduce }}</dd>
                </div>
                <div class="flex flex-wrap gap-4">
                  <div v-if="r.expected" class="min-w-[8rem] flex-1">
                    <dt class="text-xs font-semibold text-[color:var(--bs-muted)]">Expected</dt>
                    <dd class="whitespace-pre-wrap">{{ r.expected }}</dd>
                  </div>
                  <div v-if="r.actual" class="min-w-[8rem] flex-1">
                    <dt class="text-xs font-semibold text-[color:var(--bs-muted)]">Actual</dt>
                    <dd class="whitespace-pre-wrap">{{ r.actual }}</dd>
                  </div>
                </div>
                <p
                  v-if="!r.stepsToReproduce && !r.expected && !r.actual"
                  class="text-xs text-[color:var(--bs-muted)]"
                >
                  No reproduction detail was captured for this report.
                </p>
              </dl>
            </details>
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
/* Regular card header: soft light-blue band with dark-blue text (low contrast). */
.qa-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bs-blue-light);
  color: var(--bs-blue-dark);
  padding: 0.65rem 0.9rem;
  font-weight: 600;
  font-size: 0.95rem;
  width: 100%;
  text-align: left;
}
.qa-head i {
  color: var(--bs-blue);
}
.qa-head-btn :deep(.p-button-label),
.qa-head-btn :deep(.p-button-icon) {
  color: var(--bs-blue-dark);
}

/* Happy-paths hero: a distinct, slightly stronger header so it stands apart
   from the soft cards. Acts as the collapse toggle for the whole runbook. */
.qa-card--hero {
  border-color: var(--bs-blue);
}
.qa-head--hero {
  background: var(--bs-blue);
  color: #fff;
  cursor: pointer;
  border: 0;
}
.qa-head--hero i {
  color: #fff;
}
.qa-head__chev {
  margin-left: auto;
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

/* Happy-paths inner accordion: soft light-blue rows, the open one filled. */
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
  background: var(--bs-blue-light);
  color: var(--bs-blue-dark);
  font-weight: 600;
  font-size: 0.875rem;
  text-align: left;
  border-radius: 0.5rem;
}
.qa-path-head.open {
  background: var(--bs-blue);
  color: #fff;
  border-radius: 0.5rem 0.5rem 0 0;
}
.qa-path-body {
  border: 1px solid var(--bs-border);
  border-top: 0;
  border-radius: 0 0 0.5rem 0.5rem;
  padding: 0.25rem 0.85rem 0.5rem;
}

/* My bug reports: each report expands to reveal the detail captured at file time
   (steps / expected / actual). Hide the native disclosure triangle and rotate
   our own chevron on open. */
.qa-report > summary {
  list-style: none;
}
.qa-report > summary::-webkit-details-marker {
  display: none;
}
.qa-report__chev {
  transition: transform 0.15s ease;
}
.qa-report[open] .qa-report__chev {
  transform: rotate(90deg);
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
