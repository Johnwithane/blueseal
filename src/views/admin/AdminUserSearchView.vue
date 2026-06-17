<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import Avatar from "primevue/avatar";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Tag from "primevue/tag";
import Message from "primevue/message";
import type {
  JobDoc,
  TradespersonDoc,
  UserDoc,
  WithId,
} from "@/firebase/interfaces";
import { searchUsers, listUsersPage } from "@/firebase/services/users";
import { getTradesperson, getTradespersonContact } from "@/firebase/services/tradespeople";
import { listJobsForClient, listJobsForTradie } from "@/firebase/services/jobs";
import { adminGetUserAuthState, type AdminAuthState } from "@/firebase/services/admin";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import { tradeLabel } from "@/data/trades";
import { STATUS_LABEL, STATUS_SEVERITY } from "@/utils/jobStatus";
import LoadingState from "@/components/LoadingState.vue";
import AdminUserManage from "@/components/admin/AdminUserManage.vue";
import AdminUserSupport from "@/components/admin/AdminUserSupport.vue";
import AdminRoleEditor from "@/components/admin/AdminRoleEditor.vue";
import type { Role } from "@/firebase/interfaces";

const { dateTime, relativeTime, money, date } = useFormatters();

const query = ref("");
const results = ref<WithId<UserDoc>[]>([]);
const loading = ref(false);
const searched = ref(false);
const error = ref<string | null>(null);

// Two modes share the `results` list: "browse" paginates all users newest-first
// (loaded on mount); "search" narrows via searchUsers. Switching modes fully
// replaces the list + resets expansion.
const mode = ref<"browse" | "search">("browse");
const PAGE_SIZE = 25;
const cursor = ref<QueryDocumentSnapshot<UserDoc> | null>(null);
const reachedEnd = ref(false);
const loadingMore = ref(false);

// Per-uid expansion state. We lazy-load the heavier reads (tradesperson doc +
// jobs as client + jobs as tradie) on first expand so the result list stays
// snappy even when search returns 10 rows.
interface ExpandedState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  tradie: WithId<TradespersonDoc> | null;
  // Service-area address is private (tradespeople/{uid}/private/contact).
  tradieAddress: string | null;
  clientJobs: WithId<JobDoc>[];
  tradieJobs: WithId<JobDoc>[];
  // Authoritative Auth state (the Firestore emailVerified mirror can lag).
  authState: AdminAuthState | null;
  // Job lists are collapsed by default so they don't bury the admin actions.
  showClientJobs: boolean;
  showTradieJobs: boolean;
}
const expanded = ref<Record<string, ExpandedState>>({});

const RECENT_JOBS_LIMIT = 20;

// Browse: load the first page on mount; "Load more" appends with the snapshot
// cursor. Called with reset=true on mount and when returning from search.
async function loadBrowse(reset: boolean) {
  if (reset) {
    loading.value = true;
    results.value = [];
    cursor.value = null;
    reachedEnd.value = false;
    expanded.value = {};
  } else {
    loadingMore.value = true;
  }
  error.value = null;
  try {
    const page = await listUsersPage({ pageSize: PAGE_SIZE, cursor: cursor.value });
    results.value = reset ? page.users : [...results.value, ...page.users];
    cursor.value = page.lastDoc;
    reachedEnd.value = page.reachedEnd;
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

async function runSearch() {
  if (!query.value.trim()) return;
  mode.value = "search";
  loading.value = true;
  error.value = null;
  searched.value = true;
  expanded.value = {};
  try {
    results.value = await searchUsers(query.value);
  } catch (e) {
    error.value = humanizeError(e);
    results.value = [];
  } finally {
    loading.value = false;
  }
}

// Return to the full browse list.
function clearSearch() {
  query.value = "";
  searched.value = false;
  mode.value = "browse";
  void loadBrowse(true);
}

onMounted(() => loadBrowse(true));

function roleSeverity(role: string): "info" | "success" | "warn" | "danger" {
  if (role === "admin") return "warn";
  if (role === "tradesperson") return "success";
  if (role === "qa") return "danger";
  return "info";
}

function initialFor(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : "?";
}

async function toggleExpand(user: WithId<UserDoc>) {
  const existing = expanded.value[user.id];
  if (existing) {
    // Toggle off — drop the cached state so a re-expand re-fetches fresh data
    // (useful when support calls back about the same account a few minutes
    // later and we want the latest job status).
    delete expanded.value[user.id];
    return;
  }
  expanded.value[user.id] = {
    loading: true,
    loaded: false,
    error: null,
    tradie: null,
    tradieAddress: null,
    clientJobs: [],
    tradieJobs: [],
    authState: null,
    showClientJobs: false,
    showTradieJobs: false,
  };
  // Read the stored value back so we mutate the REACTIVE proxy, not the raw
  // literal. Mutating the raw object bypasses reactivity, so the post-await
  // `loading = false` never re-rendered and the panel stuck on "Loading…".
  const state = expanded.value[user.id]!;

  const isTradie = (user.roles ?? []).includes("tradesperson");
  const isClient = (user.roles ?? []).includes("client");
  try {
    const [tradie, contact, clientJobs, tradieJobs, authState] = await Promise.all([
      isTradie ? getTradesperson(user.id) : Promise.resolve(null),
      isTradie ? getTradespersonContact(user.id) : Promise.resolve(null),
      isClient ? listJobsForClient(user.id, RECENT_JOBS_LIMIT) : Promise.resolve([]),
      isTradie ? listJobsForTradie(user.id, RECENT_JOBS_LIMIT) : Promise.resolve([]),
      // Authoritative Auth state for the support panel. Best-effort — a failure
      // here shouldn't blank the whole expansion, so swallow to null.
      adminGetUserAuthState({ targetUid: user.id })
        .then((r) => r.data)
        .catch(() => null),
    ]);
    state.tradie = tradie;
    state.tradieAddress = contact?.primaryAddressText ?? null;
    state.clientJobs = clientJobs;
    state.tradieJobs = tradieJobs;
    state.authState = authState;
    state.loaded = true;
  } catch (e) {
    state.error = humanizeError(e);
  } finally {
    state.loading = false;
  }
}

function onboardingLabel(status: string | undefined): { label: string; severity: "info" | "success" | "warn" | "danger" } {
  switch (status) {
    case "enabled":
      return { label: "Payouts enabled", severity: "success" };
    case "restricted":
      return { label: "Restricted — needs info", severity: "danger" };
    case "in_progress":
      return { label: "Onboarding in progress", severity: "warn" };
    case "not_started":
    default:
      return { label: "Not started", severity: "info" };
  }
}

function vettingSeverity(s: string): "info" | "success" | "warn" | "danger" {
  if (s === "approved") return "success";
  if (s === "rejected") return "danger";
  if (s === "info_requested") return "warn";
  return "info";
}

// After an admin edits a user's roles, patch the row in place and refresh the
// tradesperson doc in the expanded panel — adding/removing the tradesperson
// role changes whether the trades editor should appear.
async function onRolesUpdated(user: WithId<UserDoc>, roles: Role[], activeRole: Role) {
  user.roles = roles;
  user.activeRole = activeRole;
  const state = expanded.value[user.id];
  if (state) {
    state.tradie = roles.includes("tradesperson") ? await getTradesperson(user.id) : null;
  }
}

// Keep the row's displayed trade list in sync after an inline trades edit.
function onTradesUpdated(user: WithId<UserDoc>, trades: string[]) {
  const tradie = expanded.value[user.id]?.tradie;
  if (tradie) tradie.trades = trades;
}

// AdminUserSupport emits a partial UserDoc after each action — merge it into the
// in-memory row so the badges/contact line update without a reload.
function onSupportPatch(user: WithId<UserDoc>, patch: Partial<UserDoc>) {
  Object.assign(user, patch);
}

// Re-pull authoritative Auth state into the expanded panel after an action that
// changes it (verify email, suspend, email change).
async function onRefreshAuth(user: WithId<UserDoc>) {
  const state = expanded.value[user.id];
  if (!state) return;
  try {
    state.authState = (await adminGetUserAuthState({ targetUid: user.id })).data;
  } catch {
    /* leave the last-known state in place */
  }
}
</script>

<template>
  <section class="bs-container max-w-3xl py-8">
    <RouterLink to="/dashboard/admin" class="text-xs text-[color:var(--bs-muted)]">
      ← Admin console
    </RouterLink>

    <header class="mt-2 mb-6">
      <p class="text-sm text-[color:var(--bs-muted)]">
        All accounts, newest first — search to narrow by name, email, phone, or
        UID. Used by support when a customer writes in.
      </p>
    </header>

    <div class="bs-card bs-form p-4">
      <label class="text-xs font-medium block mb-1">Search</label>
      <div class="flex gap-2">
        <InputText
          v-model="query"
          class="flex-1"
          placeholder="Name  ·  email@example.com  ·  +15875551234  ·  Firebase UID"
          autofocus
          @keydown.enter="runSearch"
        />
        <Button
          label="Search"
          icon="pi pi-search"
          :loading="loading && mode === 'search'"
          :disabled="!query.trim()"
          @click="runSearch"
        />
        <Button
          v-if="mode === 'search'"
          label="Clear"
          icon="pi pi-times"
          severity="secondary"
          outlined
          @click="clearSearch"
        />
      </div>
      <p class="mt-2 text-xs text-[color:var(--bs-muted)]">
        Name and email accept partial matches (case-insensitive). Phone and
        UID need to match exactly. Scans the most recent 500 accounts, so
        a very old account that doesn't match by phone/UID/exact email may
        be missed.
      </p>
    </div>

    <Message v-if="error" severity="error" :closable="false" class="mt-3">
      {{ error }}
    </Message>

    <LoadingState v-if="loading" class="mt-3" :label="mode === 'search' ? 'Searching…' : 'Loading users…'" />

    <div
      v-else-if="mode === 'search' && results.length === 0"
      class="bs-empty mt-3"
    >
      <i class="pi pi-user-edit mb-2 block text-3xl text-[color:var(--bs-border)]"></i>
      <p>No users found for "{{ query }}".</p>
    </div>

    <ul v-else-if="results.length" class="mt-4 space-y-3">
      <li v-for="u in results" :key="u.id" class="bs-card p-4">
        <div class="flex flex-wrap items-start gap-3">
          <Avatar
            v-if="u.photoURL"
            :image="u.photoURL"
            shape="circle"
            class="flex-none"
            style="width: 3rem; height: 3rem;"
          />
          <Avatar
            v-else
            :label="initialFor(u.displayName)"
            shape="circle"
            class="flex-none"
            style="width: 3rem; height: 3rem; background-color: var(--bs-blue); color: white; font-weight: 600;"
          />

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold">{{ u.displayName || "(no name)" }}</span>
              <Tag
                v-if="u.deletedAt"
                value="DELETED — pending wipe"
                severity="danger"
              />
              <Tag
                v-for="r in u.roles ?? []"
                :key="r"
                :value="r"
                :severity="roleSeverity(r)"
              />
              <span
                v-if="u.activeRole"
                class="text-xs text-[color:var(--bs-muted)]"
              >
                viewing as {{ u.activeRole }}
              </span>
            </div>

            <dl class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div class="break-all">
                <dt class="inline font-medium">Email:</dt>
                {{ u.email || "—" }}
                <span v-if="u.emailVerified" class="text-xs text-[color:var(--bs-success-text)] ml-1">
                  ✓ verified
                </span>
              </div>
              <div><dt class="inline font-medium">Phone:</dt> {{ u.phone || "—" }}</div>
              <div class="sm:col-span-2 break-all">
                <dt class="inline font-medium">UID:</dt>
                <code class="text-xs">{{ u.id }}</code>
              </div>
              <div>
                <dt class="inline font-medium">Joined:</dt>
                {{ dateTime(u.createdAt) }}
              </div>
              <div v-if="u.lastActiveAt">
                <dt class="inline font-medium">Last active:</dt>
                {{ relativeTime(u.lastActiveAt) }}
              </div>
              <div v-if="u.deletedAt">
                <dt class="inline font-medium text-[color:var(--bs-danger-text)]">Deletion requested:</dt>
                {{ relativeTime(u.deletedAt) }}
              </div>
            </dl>

            <!-- Roles editable right here by name — no need to expand + scroll. -->
            <div class="mt-2 rounded-lg bg-[color:var(--bs-surface-alt)] p-2">
              <AdminRoleEditor
                :user="u"
                @roles-updated="(roles, activeRole) => onRolesUpdated(u, roles, activeRole)"
              />
            </div>
          </div>

          <div class="flex flex-col gap-2 flex-none">
            <RouterLink :to="{ name: 'AdminUserDetail', params: { uid: u.id } }">
              <Button label="Open profile" icon="pi pi-arrow-up-right" size="small" />
            </RouterLink>
            <RouterLink
              v-if="(u.roles ?? []).includes('tradesperson')"
              :to="{ name: 'TradieProfile', params: { uid: u.id } }"
            >
              <Button label="Public profile" icon="pi pi-external-link" size="small" outlined />
            </RouterLink>
            <RouterLink
              v-if="(u.roles ?? []).includes('tradesperson')"
              :to="{ name: 'AdminApplication', params: { uid: u.id } }"
            >
              <Button label="Vetting docs" icon="pi pi-shield" size="small" outlined />
            </RouterLink>
            <Button
              :label="expanded[u.id] ? 'Hide details' : 'Show details'"
              :icon="expanded[u.id] ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
              size="small"
              text
              @click="toggleExpand(u)"
            />
          </div>
        </div>

        <!-- Expanded details panel: lazy-loaded the first time the row opens. -->
        <div
          v-if="expanded[u.id]"
          class="mt-4 border-t border-[color:var(--bs-border)] pt-4 space-y-4"
        >
          <div v-if="expanded[u.id].loading" class="bs-empty py-3 text-sm">
            Loading details…
          </div>
          <Message
            v-else-if="expanded[u.id].error"
            severity="error"
            :closable="false"
          >
            {{ expanded[u.id].error }}
          </Message>

          <template v-else-if="expanded[u.id].loaded">
            <!-- Account fundamentals — useful when the customer asks
                 "why am I not getting notifications" / "did I accept the new terms?" -->
            <section>
              <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">
                Account
              </h3>
              <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <dt class="inline font-medium">Email notifications:</dt>
                  {{ u.notificationPrefs?.emailEnabled ? "on" : "off" }}
                </div>
                <div>
                  <dt class="inline font-medium">WhatsApp notifications:</dt>
                  {{ u.notificationPrefs?.whatsappEnabled ? "on" : "off" }}
                </div>
                <div v-if="(u.roles ?? []).includes('tradesperson')">
                  <dt class="inline font-medium">New-job broadcasts:</dt>
                  {{ u.notificationPrefs?.newJobPostingEnabled === false ? "off" : "on" }}
                </div>
                <div v-if="u.termsAcceptedVersion">
                  <dt class="inline font-medium">Terms accepted:</dt>
                  v{{ u.termsAcceptedVersion }}
                  <span v-if="u.termsAcceptedAt" class="text-xs text-[color:var(--bs-muted)]">
                    ({{ date(u.termsAcceptedAt) }})
                  </span>
                </div>
                <div v-if="(u.roles ?? []).includes('client')">
                  <dt class="inline font-medium">Client rating:</dt>
                  <template v-if="u.clientRatingCount > 0">
                    {{ u.clientRatingAvg.toFixed(1) }} ★ ({{ u.clientRatingCount }})
                  </template>
                  <template v-else>no reviews yet</template>
                </div>
              </dl>
              <p v-if="u.bio" class="mt-2 text-sm">
                <span class="font-medium">Bio:</span> {{ u.bio }}
              </p>
            </section>

            <!-- Support tools (all users): email/password/access/contact/notes
                 + danger zone. Placed high — it's the most-used part for support. -->
            <AdminUserSupport
              class="border-t border-[color:var(--bs-border)] pt-4"
              :user="u"
              :auth-state="expanded[u.id].authState"
              @patch="(patch) => onSupportPatch(u, patch)"
              @refresh-auth="() => onRefreshAuth(u)"
            />

            <!-- Admin actions (trades + Pro) — only for tradespeople, placed high
                 so it isn't buried under the job lists. Roles are edited at the
                 top of the row. -->
            <AdminUserManage
              v-if="(u.roles ?? []).includes('tradesperson')"
              class="border-t border-[color:var(--bs-border)] pt-4"
              :user="u"
              :tradie="expanded[u.id].tradie"
              @trades-updated="(trades) => onTradesUpdated(u, trades)"
            />

            <!-- Tradesperson profile snapshot (only if the user has the role). -->
            <section v-if="expanded[u.id].tradie">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">
                Tradesperson profile
              </h3>
              <div class="flex flex-wrap gap-2 mb-2">
                <Tag
                  :value="expanded[u.id].tradie!.vettingStatus"
                  :severity="vettingSeverity(expanded[u.id].tradie!.vettingStatus)"
                />
                <Tag
                  :value="expanded[u.id].tradie!.isVisible ? 'visible' : 'hidden'"
                  :severity="expanded[u.id].tradie!.isVisible ? 'success' : 'secondary'"
                />
                <Tag
                  v-if="expanded[u.id].tradie!.idVerified"
                  value="ID verified"
                  severity="success"
                />
                <Tag
                  v-if="expanded[u.id].tradie!.insuranceVerified"
                  value="Insurance"
                  severity="success"
                />
                <Tag
                  v-if="expanded[u.id].tradie!.wsibVerified"
                  value="WSIB"
                  severity="success"
                />
                <Tag
                  :value="onboardingLabel(expanded[u.id].tradie!.payouts?.onboardingStatus).label"
                  :severity="onboardingLabel(expanded[u.id].tradie!.payouts?.onboardingStatus).severity"
                />
              </div>
              <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div v-if="expanded[u.id].tradie!.trades?.length">
                  <dt class="inline font-medium">Trades:</dt>
                  {{ expanded[u.id].tradie!.trades.map(tradeLabel).join(", ") }}
                </div>
                <div v-if="expanded[u.id].tradie!.hourlyRate != null">
                  <dt class="inline font-medium">Hourly rate:</dt>
                  {{ money(expanded[u.id].tradie!.hourlyRate!) }}/hr
                </div>
                <div>
                  <dt class="inline font-medium">Pricing model:</dt>
                  {{ expanded[u.id].tradie!.pricingModel }}
                </div>
                <div>
                  <dt class="inline font-medium">Rating:</dt>
                  <template v-if="expanded[u.id].tradie!.ratingCount > 0">
                    {{ expanded[u.id].tradie!.ratingAvg.toFixed(1) }} ★
                    ({{ expanded[u.id].tradie!.ratingCount }})
                  </template>
                  <template v-else>no reviews yet</template>
                </div>
                <div v-if="expanded[u.id].tradie!.companyName">
                  <dt class="inline font-medium">Company:</dt>
                  {{ expanded[u.id].tradie!.companyName }}
                </div>
                <div v-if="expanded[u.id].tradieAddress" class="sm:col-span-2">
                  <dt class="inline font-medium">Address:</dt>
                  {{ expanded[u.id].tradieAddress }}
                </div>
                <div v-if="expanded[u.id].tradie!.insuranceExpiresAt">
                  <dt class="inline font-medium">Insurance expires:</dt>
                  {{ date(expanded[u.id].tradie!.insuranceExpiresAt) }}
                </div>
                <div v-if="expanded[u.id].tradie!.wsibExpiresAt">
                  <dt class="inline font-medium">WSIB expires:</dt>
                  {{ date(expanded[u.id].tradie!.wsibExpiresAt) }}
                </div>
                <div v-if="expanded[u.id].tradie!.paidJobsCount">
                  <dt class="inline font-medium">Paid jobs:</dt>
                  {{ expanded[u.id].tradie!.paidJobsCount }}
                  <span v-if="expanded[u.id].tradie!.paidLifetimeCents" class="text-xs text-[color:var(--bs-muted)]">
                    ({{ money(expanded[u.id].tradie!.paidLifetimeCents!) }} lifetime)
                  </span>
                </div>
              </dl>
            </section>

            <!-- Jobs as client — collapsed by default. -->
            <section v-if="expanded[u.id].clientJobs.length">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 text-left"
                @click="expanded[u.id].showClientJobs = !expanded[u.id].showClientJobs"
              >
                <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)]">
                  Jobs as client ({{ expanded[u.id].clientJobs.length }}{{ expanded[u.id].clientJobs.length === RECENT_JOBS_LIMIT ? "+" : "" }})
                </h3>
                <i :class="['pi', expanded[u.id].showClientJobs ? 'pi-chevron-up' : 'pi-chevron-down', 'text-xs text-[color:var(--bs-muted)]']"></i>
              </button>
              <ul v-if="expanded[u.id].showClientJobs" class="space-y-2 mt-2">
                <li
                  v-for="job in expanded[u.id].clientJobs"
                  :key="job.id"
                  class="rounded border border-[color:var(--bs-border)] p-2 text-sm"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <Tag :value="STATUS_LABEL[job.status]" :severity="STATUS_SEVERITY[job.status]" />
                    <RouterLink
                      :to="{ name: 'JobDetail', params: { id: job.id } }"
                      class="font-medium hover:underline"
                    >
                      {{ job.title || tradeLabel(job.trade) }}
                    </RouterLink>
                  </div>
                  <div class="mt-1 text-xs text-[color:var(--bs-muted)]">
                    {{ tradeLabel(job.trade) }} · with
                    {{ job.tradespersonName || "tradesperson" }} ·
                    created {{ relativeTime(job.createdAt) }}
                    <span v-if="job.scheduledStart">
                      · scheduled {{ date(job.scheduledStart) }}
                    </span>
                  </div>
                </li>
              </ul>
            </section>

            <!-- Jobs as tradesperson — collapsed by default. -->
            <section v-if="expanded[u.id].tradieJobs.length">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 text-left"
                @click="expanded[u.id].showTradieJobs = !expanded[u.id].showTradieJobs"
              >
                <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)]">
                  Jobs as tradesperson ({{ expanded[u.id].tradieJobs.length }}{{ expanded[u.id].tradieJobs.length === RECENT_JOBS_LIMIT ? "+" : "" }})
                </h3>
                <i :class="['pi', expanded[u.id].showTradieJobs ? 'pi-chevron-up' : 'pi-chevron-down', 'text-xs text-[color:var(--bs-muted)]']"></i>
              </button>
              <ul v-if="expanded[u.id].showTradieJobs" class="space-y-2 mt-2">
                <li
                  v-for="job in expanded[u.id].tradieJobs"
                  :key="job.id"
                  class="rounded border border-[color:var(--bs-border)] p-2 text-sm"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <Tag :value="STATUS_LABEL[job.status]" :severity="STATUS_SEVERITY[job.status]" />
                    <RouterLink
                      :to="{ name: 'JobDetail', params: { id: job.id } }"
                      class="font-medium hover:underline"
                    >
                      {{ job.title || tradeLabel(job.trade) }}
                    </RouterLink>
                  </div>
                  <div class="mt-1 text-xs text-[color:var(--bs-muted)]">
                    {{ tradeLabel(job.trade) }} · for
                    {{ job.clientName || "client" }} ·
                    created {{ relativeTime(job.createdAt) }}
                    <span v-if="job.scheduledStart">
                      · scheduled {{ date(job.scheduledStart) }}
                    </span>
                  </div>
                </li>
              </ul>
            </section>

            <div
              v-if="!expanded[u.id].clientJobs.length && !expanded[u.id].tradieJobs.length"
              class="text-xs text-[color:var(--bs-muted)]"
            >
              No jobs on file for this account.
            </div>
          </template>
        </div>
      </li>
    </ul>

    <!-- Browse pagination — cursor-based "Load more". -->
    <div v-if="mode === 'browse' && results.length" class="mt-4 text-center">
      <Button
        v-if="!reachedEnd"
        label="Load more"
        icon="pi pi-chevron-down"
        outlined
        :loading="loadingMore"
        @click="loadBrowse(false)"
      />
      <p class="mt-2 text-xs text-[color:var(--bs-muted)]">
        Showing {{ results.length }} account{{ results.length === 1 ? "" : "s" }}{{ reachedEnd ? " (all)" : "" }}.
      </p>
    </div>
  </section>
</template>
