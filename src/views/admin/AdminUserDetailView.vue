<script setup lang="ts">
// Admin "User 360" — everything about one account in one place, for support +
// vetting. Deep-linkable at /admin/users/:uid and linked from the user search
// list and the vetting pages. Aggregates read-only panels (admin can read all
// these collections per firestore.rules) and reuses the shared admin action
// components (roles, support tools, tradesperson tools).
import { computed, onMounted, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Avatar from "primevue/avatar";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Message from "primevue/message";
import LoadingState from "@/components/LoadingState.vue";
import AdminRoleEditor from "@/components/admin/AdminRoleEditor.vue";
import AdminUserSupport from "@/components/admin/AdminUserSupport.vue";
import AdminUserManage from "@/components/admin/AdminUserManage.vue";
import AdminUserAuditPanel from "@/components/admin/AdminUserAuditPanel.vue";
import AdminUserMessagesPanel from "@/components/admin/AdminUserMessagesPanel.vue";
import { getUser } from "@/firebase/services/users";
import { getTradesperson, getTradespersonContact } from "@/firebase/services/tradespeople";
import { listJobsForClient, listJobsForTradie } from "@/firebase/services/jobs";
import { listReviewsFor, listClientReviewsFor } from "@/firebase/services/reviews";
import { listAcceptedVouchesFor, listAcceptedVouchesFrom } from "@/firebase/services/vouches";
import { listClientInvoices } from "@/firebase/services/invoices";
import { listJobPostsForClient } from "@/firebase/services/jobPosts";
import { adminGetUserAuthState, type AdminAuthState } from "@/firebase/services/admin";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import { tradeLabel } from "@/data/trades";
import { STATUS_LABEL, STATUS_SEVERITY } from "@/utils/jobStatus";
import type {
  ClientReviewDoc,
  InvoiceDoc,
  JobDoc,
  JobPostDoc,
  ReviewDoc,
  Role,
  TradespersonDoc,
  UserDoc,
  VouchDoc,
  WithId,
} from "@/firebase/interfaces";

const route = useRoute();
const uid = route.params.uid as string;
const { money, date, dateTime, relativeTime } = useFormatters();

const LIST_LIMIT = 20;

const loading = ref(true);
const error = ref<string | null>(null);
const user = ref<WithId<UserDoc> | null>(null);
const tradie = ref<WithId<TradespersonDoc> | null>(null);
const tradieAddress = ref<string | null>(null);
const authState = ref<AdminAuthState | null>(null);
const clientJobs = ref<WithId<JobDoc>[]>([]);
const tradieJobs = ref<WithId<JobDoc>[]>([]);
const reviewsReceived = ref<WithId<ReviewDoc>[]>([]);
const clientReviews = ref<WithId<ClientReviewDoc>[]>([]);
const vouchesFor = ref<WithId<VouchDoc>[]>([]);
const vouchesFrom = ref<WithId<VouchDoc>[]>([]);
const invoices = ref<WithId<InvoiceDoc>[]>([]);
const jobPosts = ref<WithId<JobPostDoc>[]>([]);

const isTradie = computed(() => (user.value?.roles ?? []).includes("tradesperson"));

function roleSeverity(role: string): "info" | "success" | "warn" | "danger" {
  if (role === "admin") return "warn";
  if (role === "tradesperson") return "success";
  if (role === "qa") return "danger";
  return "info";
}
function initialFor(name: string | null | undefined): string {
  const t = (name ?? "").trim();
  return t.length > 0 ? t.slice(0, 1).toUpperCase() : "?";
}
function onboardingLabel(status: string | undefined): { label: string; severity: "info" | "success" | "warn" | "danger" } {
  switch (status) {
    case "enabled": return { label: "Payouts enabled", severity: "success" };
    case "restricted": return { label: "Restricted — needs info", severity: "danger" };
    case "in_progress": return { label: "Onboarding in progress", severity: "warn" };
    default: return { label: "Payouts not started", severity: "info" };
  }
}
function vettingSeverity(s: string): "info" | "success" | "warn" | "danger" {
  if (s === "approved") return "success";
  if (s === "rejected") return "danger";
  if (s === "info_requested") return "warn";
  return "info";
}

// Each panel read is best-effort: a single failure shouldn't blank the page.
const ok = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const u = await getUser(uid);
    if (!u) {
      error.value = "No user found for this UID.";
      return;
    }
    user.value = u;
    const tradieRole = (u.roles ?? []).includes("tradesperson");
    const clientRole = (u.roles ?? []).includes("client");
    const [
      tradieDoc, contact, auth, cJobs, tJobs, rRecv, cReviews, vFor, vFrom, inv, posts,
    ] = await Promise.all([
      tradieRole ? ok(getTradesperson(uid), null) : Promise.resolve(null),
      tradieRole ? ok(getTradespersonContact(uid), null) : Promise.resolve(null),
      ok(adminGetUserAuthState({ targetUid: uid }).then((r) => r.data), null),
      clientRole ? ok(listJobsForClient(uid, LIST_LIMIT), []) : Promise.resolve([]),
      tradieRole ? ok(listJobsForTradie(uid, LIST_LIMIT), []) : Promise.resolve([]),
      tradieRole ? ok(listReviewsFor(uid), []) : Promise.resolve([]),
      ok(listClientReviewsFor(uid), []),
      ok(listAcceptedVouchesFor(uid), []),
      ok(listAcceptedVouchesFrom(uid), []),
      clientRole ? ok(listClientInvoices(uid), []) : Promise.resolve([]),
      clientRole ? ok(listJobPostsForClient(uid, LIST_LIMIT), []) : Promise.resolve([]),
    ]);
    tradie.value = tradieDoc;
    tradieAddress.value = contact?.primaryAddressText ?? null;
    authState.value = auth;
    clientJobs.value = cJobs;
    tradieJobs.value = tJobs;
    reviewsReceived.value = rRecv;
    clientReviews.value = cReviews;
    vouchesFor.value = vFor;
    vouchesFrom.value = vFrom;
    invoices.value = inv;
    jobPosts.value = posts;
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    loading.value = false;
  }
}

function onSupportPatch(patch: Partial<UserDoc>) {
  if (user.value) Object.assign(user.value, patch);
}
async function onRefreshAuth() {
  try {
    authState.value = (await adminGetUserAuthState({ targetUid: uid })).data;
  } catch {
    /* keep last-known */
  }
}
async function onRolesUpdated(roles: Role[], activeRole: Role) {
  if (!user.value) return;
  user.value.roles = roles;
  user.value.activeRole = activeRole;
  tradie.value = roles.includes("tradesperson") ? await getTradesperson(uid) : null;
}
function onTradesUpdated(trades: string[]) {
  if (tradie.value) tradie.value.trades = trades;
}

onMounted(load);
</script>

<template>
  <section class="bs-container max-w-3xl py-8">
    <RouterLink :to="{ name: 'AdminUserSearch' }" class="text-xs text-[color:var(--bs-muted)]">
      ← All users
    </RouterLink>

    <LoadingState v-if="loading" class="mt-4" label="Loading account…" />
    <Message v-else-if="error" severity="error" :closable="false" class="mt-4">{{ error }}</Message>

    <template v-else-if="user">
      <!-- Header -->
      <div class="bs-card p-4 mt-3">
        <div class="flex flex-wrap items-start gap-3">
          <Avatar v-if="user.photoURL" :image="user.photoURL" shape="circle" class="flex-none" style="width: 3.5rem; height: 3.5rem;" />
          <Avatar v-else :label="initialFor(user.displayName)" shape="circle" class="flex-none" style="width: 3.5rem; height: 3.5rem; background-color: var(--bs-blue); color: white; font-weight: 600;" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-lg">{{ user.displayName || "(no name)" }}</span>
              <Tag v-for="r in user.roles ?? []" :key="r" :value="r" :severity="roleSeverity(r)" />
            </div>
            <p class="mt-1 text-sm break-all">
              {{ user.email || "—" }}
              <span v-if="authState?.emailVerified ?? user.emailVerified" class="text-xs text-[color:var(--bs-success-text)] ml-1">✓ verified</span>
              <span v-else class="text-xs text-[color:var(--bs-muted)] ml-1">· unverified</span>
            </p>
            <p class="text-sm">{{ user.phone || "—" }}</p>
            <p class="text-xs text-[color:var(--bs-muted)] mt-1">
              UID <code>{{ user.id }}</code> · joined {{ dateTime(user.createdAt) }}
              <span v-if="user.lastActiveAt"> · last active {{ relativeTime(user.lastActiveAt) }}</span>
            </p>
          </div>
          <div class="flex flex-col gap-2 flex-none">
            <RouterLink v-if="isTradie" :to="{ name: 'TradieProfile', params: { uid: user.id } }">
              <Button label="Public profile" icon="pi pi-external-link" size="small" outlined />
            </RouterLink>
            <RouterLink v-if="isTradie" :to="{ name: 'AdminApplication', params: { uid: user.id } }">
              <Button label="Vetting docs" icon="pi pi-shield" size="small" outlined />
            </RouterLink>
          </div>
        </div>

        <Message v-if="user.deletedAt" severity="error" :closable="false" class="mt-3">
          This account is scheduled for deletion (requested {{ relativeTime(user.deletedAt) }}).
        </Message>
        <Message v-else-if="authState?.disabled || user.disabledAt" severity="warn" :closable="false" class="mt-3">
          This account is suspended<span v-if="user.disabledReason"> — {{ user.disabledReason }}</span>. The user can't sign in.
        </Message>

        <!-- Roles editable inline -->
        <div class="mt-3 rounded-lg bg-[color:var(--bs-surface-alt)] p-2">
          <AdminRoleEditor :user="user" @roles-updated="onRolesUpdated" />
        </div>
      </div>

      <!-- Support tools -->
      <div class="bs-card p-4 mt-3">
        <AdminUserSupport :user="user" :auth-state="authState" @patch="onSupportPatch" @refresh-auth="onRefreshAuth" />
      </div>

      <!-- Tradesperson tools + profile -->
      <div v-if="isTradie" class="bs-card p-4 mt-3 space-y-4">
        <AdminUserManage :user="user" :tradie="tradie" @trades-updated="onTradesUpdated" />
        <section v-if="tradie">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">Tradesperson profile</h3>
          <div class="flex flex-wrap gap-2 mb-2">
            <Tag :value="tradie.vettingStatus" :severity="vettingSeverity(tradie.vettingStatus)" />
            <Tag :value="tradie.isVisible ? 'visible' : 'hidden'" :severity="tradie.isVisible ? 'success' : 'secondary'" />
            <Tag v-if="tradie.idVerified" value="ID verified" severity="success" />
            <Tag v-if="tradie.insuranceVerified" value="Insurance" severity="success" />
            <Tag v-if="tradie.wsibVerified" value="WSIB" severity="success" />
            <Tag :value="onboardingLabel(tradie.payouts?.onboardingStatus).label" :severity="onboardingLabel(tradie.payouts?.onboardingStatus).severity" />
          </div>
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div v-if="tradie.trades?.length"><dt class="inline font-medium">Trades:</dt> {{ tradie.trades.map(tradeLabel).join(", ") }}</div>
            <div><dt class="inline font-medium">Rating:</dt>
              <template v-if="tradie.ratingCount > 0">{{ tradie.ratingAvg.toFixed(1) }} ★ ({{ tradie.ratingCount }})</template>
              <template v-else>no reviews yet</template>
            </div>
            <div v-if="tradie.companyName"><dt class="inline font-medium">Company:</dt> {{ tradie.companyName }}</div>
            <div v-if="tradieAddress" class="sm:col-span-2"><dt class="inline font-medium">Address:</dt> {{ tradieAddress }}</div>
            <div v-if="tradie.paidJobsCount"><dt class="inline font-medium">Paid jobs:</dt> {{ tradie.paidJobsCount }}
              <span v-if="tradie.paidLifetimeCents" class="text-xs text-[color:var(--bs-muted)]">({{ money(tradie.paidLifetimeCents) }} lifetime)</span>
            </div>
          </dl>
        </section>
      </div>

      <!-- Billing -->
      <div class="bs-card p-4 mt-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">Billing</h3>
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div><dt class="inline font-medium">Blue Seal Pro:</dt>
            {{ user.subscription?.status && user.subscription.status !== "none" ? user.subscription.status : "not subscribed" }}
            <span v-if="user.subscription?.proCompUntil" class="text-xs text-[color:var(--bs-muted)]">(comped to {{ date(user.subscription.proCompUntil) }})</span>
          </div>
          <div v-if="isTradie"><dt class="inline font-medium">Payouts:</dt> {{ onboardingLabel(tradie?.payouts?.onboardingStatus).label }}</div>
        </dl>
        <div v-if="invoices.length" class="mt-3">
          <h4 class="text-xs font-medium mb-1">Recent invoices ({{ invoices.length }}{{ invoices.length === LIST_LIMIT ? "+" : "" }})</h4>
          <ul class="space-y-1 text-sm">
            <li v-for="inv in invoices.slice(0, LIST_LIMIT)" :key="inv.id" class="flex items-center justify-between gap-2 rounded border border-[color:var(--bs-border)] p-2">
              <span>#{{ inv.invoiceNumber }} · {{ money(inv.total) }}</span>
              <Tag :value="inv.status" :severity="inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'info'" />
            </li>
          </ul>
        </div>
      </div>

      <!-- Jobs -->
      <div v-if="clientJobs.length || tradieJobs.length" class="bs-card p-4 mt-3 space-y-4">
        <section v-if="tradieJobs.length">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">Jobs as tradesperson ({{ tradieJobs.length }}{{ tradieJobs.length === LIST_LIMIT ? "+" : "" }})</h3>
          <ul class="space-y-2">
            <li v-for="job in tradieJobs" :key="job.id" class="rounded border border-[color:var(--bs-border)] p-2 text-sm">
              <div class="flex flex-wrap items-center gap-2">
                <Tag :value="STATUS_LABEL[job.status]" :severity="STATUS_SEVERITY[job.status]" />
                <RouterLink :to="{ name: 'JobDetail', params: { id: job.id } }" class="font-medium hover:underline">{{ job.title || tradeLabel(job.trade) }}</RouterLink>
              </div>
              <div class="mt-1 text-xs text-[color:var(--bs-muted)]">{{ tradeLabel(job.trade) }} · for {{ job.clientName || "client" }} · created {{ relativeTime(job.createdAt) }}</div>
            </li>
          </ul>
        </section>
        <section v-if="clientJobs.length">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">Jobs as client ({{ clientJobs.length }}{{ clientJobs.length === LIST_LIMIT ? "+" : "" }})</h3>
          <ul class="space-y-2">
            <li v-for="job in clientJobs" :key="job.id" class="rounded border border-[color:var(--bs-border)] p-2 text-sm">
              <div class="flex flex-wrap items-center gap-2">
                <Tag :value="STATUS_LABEL[job.status]" :severity="STATUS_SEVERITY[job.status]" />
                <RouterLink :to="{ name: 'JobDetail', params: { id: job.id } }" class="font-medium hover:underline">{{ job.title || tradeLabel(job.trade) }}</RouterLink>
              </div>
              <div class="mt-1 text-xs text-[color:var(--bs-muted)]">{{ tradeLabel(job.trade) }} · with {{ job.tradespersonName || "tradesperson" }} · created {{ relativeTime(job.createdAt) }}</div>
            </li>
          </ul>
        </section>
      </div>

      <!-- Job board posts (client) -->
      <div v-if="jobPosts.length" class="bs-card p-4 mt-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">Job-board posts ({{ jobPosts.length }}{{ jobPosts.length === LIST_LIMIT ? "+" : "" }})</h3>
        <ul class="space-y-2 text-sm">
          <li v-for="p in jobPosts" :key="p.id" class="flex items-center justify-between gap-2 rounded border border-[color:var(--bs-border)] p-2">
            <span>{{ p.title || tradeLabel(p.trade) }}</span>
            <Tag :value="p.status" :severity="p.status === 'open' ? 'success' : 'secondary'" />
          </li>
        </ul>
      </div>

      <!-- Reviews -->
      <div v-if="reviewsReceived.length || clientReviews.length" class="bs-card p-4 mt-3 space-y-4">
        <section v-if="reviewsReceived.length">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">Reviews as tradesperson ({{ reviewsReceived.length }})</h3>
          <ul class="space-y-2 text-sm">
            <li v-for="r in reviewsReceived" :key="r.id" class="rounded border border-[color:var(--bs-border)] p-2">
              <span class="font-medium">{{ r.rating }} ★</span>
              <span v-if="r.text"> — {{ r.text }}</span>
              <span class="block text-xs text-[color:var(--bs-muted)]">{{ relativeTime(r.createdAt) }}</span>
            </li>
          </ul>
        </section>
        <section v-if="clientReviews.length">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">Reviews as client ({{ clientReviews.length }})</h3>
          <ul class="space-y-2 text-sm">
            <li v-for="r in clientReviews" :key="r.id" class="rounded border border-[color:var(--bs-border)] p-2">
              <span class="font-medium">{{ r.rating }} ★</span>
              <span v-if="r.text"> — {{ r.text }}</span>
              <span class="block text-xs text-[color:var(--bs-muted)]">{{ relativeTime(r.createdAt) }}</span>
            </li>
          </ul>
        </section>
      </div>

      <!-- Vouches -->
      <div v-if="vouchesFor.length || vouchesFrom.length" class="bs-card p-4 mt-3 space-y-3">
        <section v-if="vouchesFor.length">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">Vouches received ({{ vouchesFor.length }})</h3>
          <ul class="text-sm space-y-1">
            <li v-for="v in vouchesFor" :key="v.id">{{ v.fromDisplayName }}<span v-if="v.fromPrimaryTrade" class="text-[color:var(--bs-muted)]"> · {{ tradeLabel(v.fromPrimaryTrade) }}</span></li>
          </ul>
        </section>
        <section v-if="vouchesFrom.length">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">Vouches given ({{ vouchesFrom.length }})</h3>
          <ul class="text-sm space-y-1">
            <li v-for="v in vouchesFrom" :key="v.id">{{ v.toDisplayName }}</li>
          </ul>
        </section>
      </div>

      <!-- Message history (job chats) -->
      <div class="bs-card p-4 mt-3">
        <AdminUserMessagesPanel :uid="user.id" />
      </div>

      <!-- Audit log -->
      <div class="bs-card p-4 mt-3">
        <AdminUserAuditPanel :uid="user.id" />
      </div>
    </template>
  </section>
</template>
