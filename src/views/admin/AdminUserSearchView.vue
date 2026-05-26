<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
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
import { searchUsers } from "@/firebase/services/users";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { listJobsForClient, listJobsForTradie } from "@/firebase/services/jobs";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import { tradeLabel } from "@/data/trades";
import { STATUS_LABEL, STATUS_SEVERITY } from "@/utils/jobStatus";

const { dateTime, relativeTime, money, date } = useFormatters();

const query = ref("");
const results = ref<WithId<UserDoc>[]>([]);
const loading = ref(false);
const searched = ref(false);
const error = ref<string | null>(null);

// Per-uid expansion state. We lazy-load the heavier reads (tradesperson doc +
// jobs as client + jobs as tradie) on first expand so the result list stays
// snappy even when search returns 10 rows.
interface ExpandedState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  tradie: WithId<TradespersonDoc> | null;
  clientJobs: WithId<JobDoc>[];
  tradieJobs: WithId<JobDoc>[];
}
const expanded = ref<Record<string, ExpandedState>>({});

const RECENT_JOBS_LIMIT = 20;

async function runSearch() {
  if (!query.value.trim()) return;
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

function roleSeverity(role: string): "info" | "success" | "warn" {
  if (role === "admin") return "warn";
  if (role === "tradesperson") return "success";
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
  const state: ExpandedState = {
    loading: true,
    loaded: false,
    error: null,
    tradie: null,
    clientJobs: [],
    tradieJobs: [],
  };
  expanded.value[user.id] = state;

  const isTradie = (user.roles ?? []).includes("tradesperson");
  const isClient = (user.roles ?? []).includes("client");
  try {
    const [tradie, clientJobs, tradieJobs] = await Promise.all([
      isTradie ? getTradesperson(user.id) : Promise.resolve(null),
      isClient ? listJobsForClient(user.id, RECENT_JOBS_LIMIT) : Promise.resolve([]),
      isTradie ? listJobsForTradie(user.id, RECENT_JOBS_LIMIT) : Promise.resolve([]),
    ]);
    state.tradie = tradie;
    state.clientJobs = clientJobs;
    state.tradieJobs = tradieJobs;
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
</script>

<template>
  <section class="bs-container max-w-3xl py-8">
    <RouterLink to="/dashboard/admin" class="text-xs text-[color:var(--bs-muted)]">
      ← Admin console
    </RouterLink>

    <header class="mt-2 mb-6">
      <p class="text-sm text-[color:var(--bs-muted)]">
        Look up an account by name, email, phone, or UID. Used by support
        when a customer writes in.
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
          :loading="loading"
          :disabled="!query.trim()"
          @click="runSearch"
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

    <div v-if="loading" class="bs-empty mt-3">Searching…</div>

    <div
      v-else-if="searched && results.length === 0"
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
                <span v-if="u.emailVerified" class="text-xs text-green-700 ml-1">
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
                <dt class="inline font-medium text-red-700">Deletion requested:</dt>
                {{ relativeTime(u.deletedAt) }}
              </div>
            </dl>
          </div>

          <div class="flex flex-col gap-2 flex-none">
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
                <div v-if="expanded[u.id].tradie!.primaryAddressText" class="sm:col-span-2">
                  <dt class="inline font-medium">Address:</dt>
                  {{ expanded[u.id].tradie!.primaryAddressText }}
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

            <section v-if="expanded[u.id].clientJobs.length">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">
                Jobs as client ({{ expanded[u.id].clientJobs.length }}{{ expanded[u.id].clientJobs.length === RECENT_JOBS_LIMIT ? "+" : "" }})
              </h3>
              <ul class="space-y-2">
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

            <section v-if="expanded[u.id].tradieJobs.length">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">
                Jobs as tradesperson ({{ expanded[u.id].tradieJobs.length }}{{ expanded[u.id].tradieJobs.length === RECENT_JOBS_LIMIT ? "+" : "" }})
              </h3>
              <ul class="space-y-2">
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
  </section>
</template>
