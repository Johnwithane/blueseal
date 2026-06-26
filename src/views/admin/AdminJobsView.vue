<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Tag from "primevue/tag";
import Message from "primevue/message";
import type {
  JobDoc,
  JobPostDoc,
  JobPostStatus,
  JobStatus,
  RegionDoc,
  WithId,
} from "@/firebase/interfaces";
import { listAllJobs } from "@/firebase/services/jobs";
import { listAllJobPosts } from "@/firebase/services/jobPosts";
import { listRegions } from "@/firebase/services/regions";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import { tradeLabel } from "@/data/trades";
import { CA_PROVINCES, provinceLabel } from "@/data/provinces";
import { matchRegionId } from "@/utils/regionMatch";
import { STATUS_LABEL, STATUS_SEVERITY, type StatusSeverity } from "@/utils/jobStatus";
import LoadingState from "@/components/LoadingState.vue";

const { relativeTime, date, money } = useFormatters();

// How many of the most-recent docs we pull per surface. The dataset is small
// (early stage), so we fetch a bounded page newest-first and do region/status/
// text filtering client-side — no composite indexes, instant filter changes.
// If a surface ever hits the cap we say so (no silent truncation).
const MAX = 300;

const loading = ref(true);
const error = ref<string | null>(null);
const jobs = ref<WithId<JobDoc>[]>([]);
const posts = ref<WithId<JobPostDoc>[]>([]);
const regions = ref<WithId<RegionDoc>[]>([]);

// Which surface is shown. "jobs" = the in-flight pipeline (jobs/), "posts" =
// the job-board postings clients put up for quotes (jobPosts/).
const surface = ref<"jobs" | "posts">("jobs");
const surfaceOptions = [
  { label: "Active jobs", value: "jobs" },
  { label: "Posted jobs", value: "posts" },
];

const search = ref("");
const provinceFilter = ref<string | null>(null);
const regionFilter = ref<string | null>(null);
const statusFilter = ref<string | null>(null);

const provinceOptions = CA_PROVINCES.map((p) => ({ label: p.label, value: p.code }));
const regionOptions = computed(() =>
  regions.value.map((r) => ({ label: `${r.name} (${r.province})`, value: r.id })),
);

// Job-post status has no shared label/severity helper (jobs do, in jobStatus.ts)
// — these are only used here, so they stay local.
const POST_STATUS_LABEL: Record<JobPostStatus, string> = {
  open: "Open",
  invited: "Invited",
  closed: "Closed",
  cancelled: "Cancelled",
  expired: "Expired",
  admin_hidden: "Hidden",
};
const POST_STATUS_SEVERITY: Record<JobPostStatus, StatusSeverity> = {
  open: "success",
  invited: "info",
  closed: "secondary",
  cancelled: "danger",
  expired: "warn",
  admin_hidden: "danger",
};

const statusOptions = computed(() =>
  surface.value === "jobs"
    ? (Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => ({
        label: STATUS_LABEL[s],
        value: s,
      }))
    : (Object.keys(POST_STATUS_LABEL) as JobPostStatus[]).map((s) => ({
        label: POST_STATUS_LABEL[s],
        value: s,
      })),
);

// Status values don't carry across surfaces (a job status isn't a post status),
// so reset the status filter when the surface flips. Province/region/text stay.
watch(surface, () => {
  statusFilter.value = null;
});

function matchesRegion(postalOrFsa: string): boolean {
  if (!regionFilter.value) return true;
  return matchRegionId(postalOrFsa, regions.value) === regionFilter.value;
}

function matchesSearch(haystack: string): boolean {
  const q = search.value.trim().toLowerCase();
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

const filteredJobs = computed(() =>
  jobs.value.filter((j) => {
    if (provinceFilter.value && (j.address?.region ?? "").toUpperCase() !== provinceFilter.value)
      return false;
    if (!matchesRegion(j.address?.postalCode ?? "")) return false;
    if (statusFilter.value && j.status !== statusFilter.value) return false;
    return matchesSearch(
      [
        j.title,
        tradeLabel(j.trade),
        j.clientName ?? "",
        j.tradespersonName ?? "",
        j.address?.city ?? "",
        j.address?.line1 ?? "",
      ].join(" "),
    );
  }),
);

const filteredPosts = computed(() =>
  posts.value.filter((p) => {
    if (provinceFilter.value && (p.addressPublic?.region ?? "").toUpperCase() !== provinceFilter.value)
      return false;
    if (!matchesRegion(p.addressPublic?.postalFsa ?? "")) return false;
    if (statusFilter.value && p.status !== statusFilter.value) return false;
    return matchesSearch(
      [p.title, tradeLabel(p.trade), p.clientName ?? "", p.addressPublic?.city ?? ""].join(" "),
    );
  }),
);

const activeCount = computed(() =>
  surface.value === "jobs" ? filteredJobs.value.length : filteredPosts.value.length,
);
const loadedCount = computed(() =>
  surface.value === "jobs" ? jobs.value.length : posts.value.length,
);
const capHit = computed(() => loadedCount.value >= MAX);

const hasFilters = computed(
  () =>
    !!search.value.trim() ||
    !!provinceFilter.value ||
    !!regionFilter.value ||
    !!statusFilter.value,
);

function clearFilters() {
  search.value = "";
  provinceFilter.value = null;
  regionFilter.value = null;
  statusFilter.value = null;
}

onMounted(async () => {
  loading.value = true;
  error.value = null;
  // allSettled: a regions/posts read failing shouldn't blank the whole view.
  const [j, p, r] = await Promise.allSettled([listAllJobs(MAX), listAllJobPosts(MAX), listRegions()]);
  if (j.status === "fulfilled") jobs.value = j.value;
  if (p.status === "fulfilled") posts.value = p.value;
  if (r.status === "fulfilled") regions.value = r.value;
  // Only surface an error if the surface the admin lands on came back empty due
  // to a failure (region list is best-effort — the territory filter just won't
  // populate).
  if (j.status === "rejected" && p.status === "rejected") {
    error.value = humanizeError(j.reason);
  }
  loading.value = false;
});
</script>

<template>
  <section class="bs-container max-w-3xl py-8">
    <RouterLink to="/dashboard/admin" class="text-xs text-[color:var(--bs-muted)]">
      ← Admin console
    </RouterLink>

    <header class="mt-2 mb-4">
      <h1 class="text-lg font-semibold">Jobs &amp; postings</h1>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Every job and job-board posting across all regions, newest first. Filter
        by province or sales territory, narrow by status, or search by title,
        trade, name, or city.
      </p>
    </header>

    <!-- Surface toggle: pipeline jobs vs job-board postings. -->
    <SelectButton
      v-model="surface"
      :options="surfaceOptions"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      class="mb-4"
    />

    <div class="bs-card bs-form p-4 space-y-3">
      <div>
        <label class="text-xs font-medium block mb-1">Search</label>
        <InputText
          v-model="search"
          class="w-full"
          placeholder="Title · trade · client / tradesperson · city"
        />
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="text-xs font-medium block mb-1">Province</label>
          <Select
            v-model="provinceFilter"
            :options="provinceOptions"
            option-label="label"
            option-value="value"
            placeholder="All provinces"
            show-clear
            class="w-full"
          />
        </div>
        <div>
          <label class="text-xs font-medium block mb-1">Sales territory</label>
          <Select
            v-model="regionFilter"
            :options="regionOptions"
            option-label="label"
            option-value="value"
            :placeholder="regionOptions.length ? 'All territories' : 'No regions yet'"
            :disabled="!regionOptions.length"
            show-clear
            filter
            class="w-full"
          />
        </div>
        <div>
          <label class="text-xs font-medium block mb-1">Status</label>
          <Select
            v-model="statusFilter"
            :options="statusOptions"
            option-label="label"
            option-value="value"
            placeholder="Any status"
            show-clear
            class="w-full"
          />
        </div>
      </div>
      <div v-if="hasFilters" class="flex justify-end">
        <Button label="Clear filters" icon="pi pi-times" size="small" text @click="clearFilters" />
      </div>
    </div>

    <Message v-if="error" severity="error" :closable="false" class="mt-3">
      {{ error }}
    </Message>

    <LoadingState v-if="loading" class="mt-4" label="Loading jobs…" />

    <template v-else>
      <p class="mt-4 mb-2 text-xs text-[color:var(--bs-muted)]">
        {{ activeCount }}
        {{ surface === "jobs" ? "job" : "posting" }}{{ activeCount === 1 ? "" : "s" }}
        <span v-if="hasFilters">matching · {{ loadedCount }} loaded</span>
        <span v-else>· {{ loadedCount }} loaded</span>
        <span v-if="capHit"> (most recent {{ MAX }} — refine filters to reach older records)</span>
      </p>

      <!-- Active jobs (pipeline). -->
      <ul v-if="surface === 'jobs'" class="space-y-3">
        <li v-for="job in filteredJobs" :key="job.id" class="bs-card p-4">
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
            {{ tradeLabel(job.trade) }} ·
            {{ job.clientName || "client" }} → {{ job.tradespersonName || "tradesperson" }}
          </div>
          <div class="mt-1 text-xs text-[color:var(--bs-muted)]">
            <span v-if="job.address?.city">{{ job.address.city }}, </span>
            {{ provinceLabel(job.address?.region ?? "—") }}
            · created {{ relativeTime(job.createdAt) }}
            <span v-if="job.scheduledStart"> · scheduled {{ date(job.scheduledStart) }}</span>
          </div>
        </li>
      </ul>

      <!-- Posted jobs (job board). -->
      <ul v-else class="space-y-3">
        <li v-for="post in filteredPosts" :key="post.id" class="bs-card p-4">
          <div class="flex flex-wrap items-center gap-2">
            <Tag :value="POST_STATUS_LABEL[post.status]" :severity="POST_STATUS_SEVERITY[post.status]" />
            <RouterLink
              :to="{ name: 'JobPostDetail', params: { postId: post.id } }"
              class="font-medium hover:underline"
            >
              {{ post.title || tradeLabel(post.trade) }}
            </RouterLink>
          </div>
          <div class="mt-1 text-xs text-[color:var(--bs-muted)]">
            {{ tradeLabel(post.trade) }} · posted by {{ post.clientName || "client" }}
            <span v-if="post.budget"> · budget {{ money(post.budget.min) }}–{{ money(post.budget.max) }}</span>
          </div>
          <div class="mt-1 text-xs text-[color:var(--bs-muted)]">
            <span v-if="post.addressPublic?.city">{{ post.addressPublic.city }}, </span>
            {{ provinceLabel(post.addressPublic?.region ?? "—") }}
            · created {{ relativeTime(post.createdAt) }}
            <span v-if="post.status === 'open'"> · expires {{ date(post.expiresAt) }}</span>
          </div>
        </li>
      </ul>

      <div v-if="activeCount === 0" class="bs-empty mt-2">
        <i class="pi pi-inbox mb-2 block text-3xl text-[color:var(--bs-border)]"></i>
        <p v-if="hasFilters">No {{ surface === "jobs" ? "jobs" : "postings" }} match these filters.</p>
        <p v-else>No {{ surface === "jobs" ? "jobs" : "postings" }} yet.</p>
      </div>
    </template>
  </section>
</template>
