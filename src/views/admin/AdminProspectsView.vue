<script setup lang="ts">
// Admin lead-generation tool: browse the seeded prospect pool (private by
// default), reach out to each one with a personal, editable email, and track
// who's been contacted / claimed. Reads Firestore directly (admins have
// read/write on prospects per firestore.rules); the send goes through the
// sendProspectOutreach callable.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Tag from "primevue/tag";
import Message from "primevue/message";
import LoadingState from "@/components/LoadingState.vue";
import ProspectOutreachComposer from "@/components/admin/ProspectOutreachComposer.vue";
import ProspectProfileEditor from "@/components/admin/ProspectProfileEditor.vue";
import { listAllProspects } from "@/firebase/services/prospects";
import type { ProspectDoc, ProspectStatus, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { tradeLabel } from "@/data/trades";

const prospects = ref<WithId<ProspectDoc>[]>([]);
const loading = ref(true);
const search = ref("");
const tradeFilter = ref<string | null>(null);
const statusFilter = ref<ProspectStatus | null>(null);
const selected = ref<WithId<ProspectDoc> | null>(null);
const composerVisible = ref(false);
const editorProspect = ref<WithId<ProspectDoc> | null>(null);
const editorVisible = ref(false);

const { relativeTime } = useFormatters();
const toast = useToast();

async function refresh() {
  loading.value = true;
  try {
    prospects.value = await listAllProspects();
  } catch (e) {
    toast.error("Couldn't load prospects", humanizeError(e));
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);

const stats = computed(() => {
  const all = prospects.value;
  return {
    total: all.length,
    pending: all.filter((p) => p.status === "listed" && p.outreachCount === 0).length,
    contacted: all.filter((p) => p.outreachCount > 0 || p.status === "outreach_sent").length,
    claimed: all.filter((p) => p.status === "claimed").length,
  };
});

const tradeOptions = computed(() => {
  const keys = new Set<string>();
  for (const p of prospects.value) for (const t of p.trades) keys.add(t);
  return [...keys].sort().map((k) => ({ label: tradeLabel(k), value: k }));
});

const statusOptions: Array<{ label: string; value: ProspectStatus }> = [
  { label: "Not contacted", value: "listed" },
  { label: "Outreach sent", value: "outreach_sent" },
  { label: "Claimed", value: "claimed" },
  { label: "Suppressed", value: "suppressed" },
];

// Google signal lives in extra fields not on the typed doc.
function gOf(p: WithId<ProspectDoc>): { googleRating?: number; googleReviewCount?: number } {
  return p as unknown as { googleRating?: number; googleReviewCount?: number };
}

// Eligibility = how complete + "ready to reach out" a listing is. Scraped
// listings carry no email (Google never exposes one), so this leans on
// description, photos, website + Google review strength. Higher = better.
function eligibility(p: WithId<ProspectDoc>): number {
  let s = 0;
  const bio = (p.bio ?? "").trim();
  if (bio.length > 60) s += 25;
  else if (bio) s += 12;
  if (p.portfolioPhotos?.length) s += 18;
  if (p.photoURL) s += 8; // a real /p/ photo (null => initials avatar)
  if (p.website) s += 14;
  if (p.emailHash) s += 15; // has a usable email (claim + outreach ready)
  const rc = gOf(p).googleReviewCount ?? 0;
  if (rc >= 25) s += 20;
  else if (rc > 0) s += 10;
  return s;
}

// Rough distance (km) from the Kelowna core so we can work outward from it.
const KELOWNA = { lat: 49.888, lng: -119.496 };
function distKm(p: WithId<ProspectDoc>): number {
  const loc = p.locationApprox as { latitude?: number; longitude?: number } | undefined;
  if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") {
    return Number.POSITIVE_INFINITY;
  }
  const dLat = (loc.latitude - KELOWNA.lat) * 111;
  const dLng = (loc.longitude - KELOWNA.lng) * 111 * Math.cos((KELOWNA.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

const sortMode = ref<"eligible" | "nearest" | "reviews">("eligible");
const sortOptions = [
  { label: "Most eligible", value: "eligible" },
  { label: "Closest to Kelowna", value: "nearest" },
  { label: "Most Google reviews", value: "reviews" },
];
const townFilter = ref<string | null>(null);
const townOptions = computed(() => {
  const set = new Set<string>();
  for (const p of prospects.value) if (p.locationLabel) set.add(p.locationLabel);
  return [...set].sort().map((t) => ({ label: t, value: t }));
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return prospects.value.filter((p) => {
    if (tradeFilter.value && !p.trades.includes(tradeFilter.value)) return false;
    if (statusFilter.value && p.status !== statusFilter.value) return false;
    if (townFilter.value && p.locationLabel !== townFilter.value) return false;
    if (q) {
      const hay = `${p.displayName} ${p.companyName ?? ""} ${p.locationLabel ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
});

// Sort the filtered set by the chosen mode (eligibility, proximity, or reviews),
// each with a sensible tie-breaker.
const sorted = computed(() => {
  const arr = [...filtered.value];
  if (sortMode.value === "nearest") {
    arr.sort((a, b) => distKm(a) - distKm(b) || eligibility(b) - eligibility(a));
  } else if (sortMode.value === "reviews") {
    arr.sort(
      (a, b) =>
        (gOf(b).googleReviewCount ?? 0) - (gOf(a).googleReviewCount ?? 0) ||
        eligibility(b) - eligibility(a),
    );
  } else {
    arr.sort((a, b) => eligibility(b) - eligibility(a) || distKm(a) - distKm(b));
  }
  return arr;
});

// Lazy rendering: with thousands of prospects, painting every card at once
// freezes the tab. We render a growing window of the (already client-filtered)
// list, extended on scroll via an IntersectionObserver + a "Load more" fallback.
const PAGE = 50;
const visibleCount = ref(PAGE);
const visible = computed(() => sorted.value.slice(0, visibleCount.value));
const hasMore = computed(() => visibleCount.value < sorted.value.length);
const loadMoreEl = ref<HTMLElement | null>(null);

function showMore() {
  visibleCount.value = Math.min(visibleCount.value + PAGE, sorted.value.length);
}

// Any filter / sort / search change resets the window to the top.
watch([search, tradeFilter, statusFilter, townFilter, sortMode], () => {
  visibleCount.value = PAGE;
});

let observer: IntersectionObserver | null = null;
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && hasMore.value) showMore();
    },
    { rootMargin: "600px" },
  );
});
// Re-observe whenever the sentinel mounts/unmounts (it's v-if'd on hasMore).
watch(loadMoreEl, (el, prev) => {
  if (prev) observer?.unobserve(prev);
  if (el) observer?.observe(el);
});
onBeforeUnmount(() => observer?.disconnect());

function statusSeverity(s: ProspectStatus): string {
  return { listed: "secondary", outreach_sent: "info", claimed: "success", suppressed: "danger" }[s];
}

function tradesLabel(p: WithId<ProspectDoc>): string {
  return p.trades.map((k) => tradeLabel(k)).join(", ") || "—";
}

function openComposer(p: WithId<ProspectDoc>) {
  selected.value = p;
  composerVisible.value = true;
}

function openEditor(p: WithId<ProspectDoc>) {
  editorProspect.value = p;
  editorVisible.value = true;
}
</script>

<template>
  <section class="bs-container py-6">
    <div class="mb-4">
      <RouterLink to="/dashboard" class="text-xs text-[color:var(--bs-muted)]">← Back</RouterLink>
      <h1 class="text-xl font-semibold mt-1">Prospect outreach</h1>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        Pre-built listings from public research. These stay private and are never shown publicly.
        Reach out with a personal email inviting them to claim their free profile.
      </p>
    </div>

    <Message severity="info" :closable="false" class="mb-4">
      <span class="text-xs">
        Sending needs go-live setup (business mailing address, unsubscribe secret, email-link
        sign-in). Until those are configured, the editor works but Send will report what's missing.
        See HUMANTASKS.md.
      </span>
    </Message>

    <!-- Stats -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
      <div class="bs-card p-3 text-center">
        <div class="text-lg font-semibold">{{ stats.total }}</div>
        <div class="text-xs text-[color:var(--bs-muted)]">Total</div>
      </div>
      <div class="bs-card p-3 text-center">
        <div class="text-lg font-semibold">{{ stats.contacted }}</div>
        <div class="text-xs text-[color:var(--bs-muted)]">Contacted</div>
      </div>
      <div class="bs-card p-3 text-center">
        <div class="text-lg font-semibold">{{ stats.claimed }}</div>
        <div class="text-xs text-[color:var(--bs-muted)]">Claimed</div>
      </div>
      <div class="bs-card p-3 text-center">
        <div class="text-lg font-semibold">{{ stats.pending }}</div>
        <div class="text-xs text-[color:var(--bs-muted)]">Not contacted</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-col sm:flex-row gap-2 mb-4">
      <InputText v-model="search" placeholder="Search name, company, town" class="flex-1" />
      <Select
        v-model="tradeFilter"
        :options="tradeOptions"
        option-label="label"
        option-value="value"
        placeholder="All trades"
        show-clear
        class="sm:w-52"
      />
      <Select
        v-model="statusFilter"
        :options="statusOptions"
        option-label="label"
        option-value="value"
        placeholder="All statuses"
        show-clear
        class="sm:w-44"
      />
      <Select
        v-model="townFilter"
        :options="townOptions"
        option-label="label"
        option-value="value"
        placeholder="All towns"
        filter
        show-clear
        class="sm:w-44"
      />
      <Select
        v-model="sortMode"
        :options="sortOptions"
        option-label="label"
        option-value="value"
        class="sm:w-52"
      />
      <Button label="Refresh" icon="pi pi-refresh" outlined :loading="loading" @click="refresh" />
    </div>

    <LoadingState v-if="loading" />
    <div v-else-if="filtered.length === 0" class="bs-empty">
      <i class="pi pi-inbox mr-2" />No prospects match.
    </div>
    <template v-else>
      <p class="text-xs text-[color:var(--bs-muted)] mb-2">
        Showing {{ visible.length }} of {{ filtered.length }}
      </p>
      <ul class="space-y-2">
        <li
          v-for="p in visible"
          :key="p.id"
          class="bs-card p-3 flex flex-wrap items-center justify-between gap-3"
        >
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">{{ p.companyName || p.displayName }}</span>
            <Tag :value="p.status" :severity="statusSeverity(p.status)" />
          </div>
          <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
            {{ tradesLabel(p) }}
            <template v-if="p.locationLabel"> · {{ p.locationLabel }}</template>
            <template v-if="gOf(p).googleReviewCount">
              · <i class="pi pi-star-fill text-[10px] text-[color:var(--bs-amber)]" />
              {{ gOf(p).googleRating }} ({{ gOf(p).googleReviewCount }})
            </template>
            <template v-if="p.outreachCount > 0"> · contacted {{ relativeTime(p.lastOutreachAt) }}</template>
          </div>
        </div>
        <div class="flex gap-2">
          <a :href="`/tradies/${p.id}`" target="_blank" rel="noopener">
            <Button label="View" icon="pi pi-eye" size="small" text />
          </a>
          <Button label="Edit" icon="pi pi-pencil" size="small" text @click="openEditor(p)" />
          <Button
            label="Reach out"
            icon="pi pi-send"
            size="small"
            :disabled="p.status === 'claimed' || p.status === 'suppressed'"
            @click="openComposer(p)"
          />
        </div>
        </li>
      </ul>

      <div v-if="hasMore" ref="loadMoreEl" class="py-4 text-center">
        <Button
          :label="`Load more (${filtered.length - visibleCount} remaining)`"
          text
          @click="showMore"
        />
      </div>
    </template>

    <ProspectOutreachComposer
      v-model:visible="composerVisible"
      :prospect="selected"
      @sent="refresh"
      @changed="refresh"
      @edit-profile="openEditor"
    />
    <ProspectProfileEditor
      v-model:visible="editorVisible"
      :prospect="editorProspect"
      @saved="refresh"
    />
  </section>
</template>
