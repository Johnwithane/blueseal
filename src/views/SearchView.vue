<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from "vue";
import { searchCache } from "./searchCache";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import Select from "primevue/select";
import Rating from "primevue/rating";
import Message from "primevue/message";
import Dialog from "primevue/dialog";
import {
  searchTradespeople,
  getTradespersonContact,
  type AvailabilityFilter,
} from "@/firebase/services/tradespeople";
import { searchProspects } from "@/firebase/services/prospects";
import { useAuthStore } from "@/stores/auth";
import { TRADES, tradeLabel, tradePlural } from "@/data/trades";
import type { TradeSuggestion } from "@/data/tradeKeywords";
import { saveRequestPrefill } from "@/utils/requestPrefill";
import { lookupIpRegion } from "@/utils/ipRegion";
import type { AvatarMarkerData } from "@/utils/avatarMarker";
import TradeDescribeBox from "@/components/TradeDescribeBox.vue";
import TradieCard from "@/components/TradieCard.vue";
import ProspectCard from "@/components/ProspectCard.vue";
import LocationPicker, {
  type LocationValue,
} from "@/components/LocationPicker.vue";
import type { ProspectDoc, TradespersonDoc, WithId } from "@/firebase/interfaces";
import LoadingState from "@/components/LoadingState.vue";
import { useSeo } from "@/composables/useSeo";
import { searchSeo, tradePageSeo } from "@/seo/content";
import {
  hydrateSavedTradies,
  saveTradie,
  subscribeSavedTradieIds,
  unsaveTradie,
} from "@/firebase/services/savedTradies";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

function tradeFromQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return TRADES.some((t) => t.key === value) ? value : null;
}

const trade = ref<string | null>(tradeFromQuery(route.query.trade));
const minRating = ref(0);
const availability = ref<AvailabilityFilter>("any");

// "Describe what you need" → instant trade suggestions (TradeDescribeBox). Lets
// a client who knows the symptom or room but not the trade name jump straight to
// the right filter instead of scrolling a 60-item dropdown.
const describe = ref(typeof route.query.q === "string" ? route.query.q : "");

// Tapping a suggestion sets the trade filter and searches — the dropdown below
// updates in lockstep (shared `trade` ref) so the choice is visible.
function applySuggestion(s: TradeSuggestion) {
  trade.value = s.key;
  search();
}

// SEO: when a trade filter is active, point the canonical at the clean
// /trades/:trade landing page so filtered search variants consolidate there
// instead of competing as duplicate ?trade= URLs.
useSeo(() => (trade.value ? (tradePageSeo(trade.value) ?? searchSeo()) : searchSeo()));

// Sticky location persistence. Bare camelCase key matches the existing
// localStorage draft convention in PostJobView.vue.
const SEARCH_LOCATION_KEY = "searchLocation";

// Restore the last-used search location so a returning user never has to
// re-pick where they're searching. Returns null when nothing valid is stored.
function loadStoredLocation(): LocationValue | null {
  try {
    const raw = localStorage.getItem(SEARCH_LOCATION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LocationValue>;
    if (typeof v.lat === "number" && typeof v.lng === "number") {
      return {
        lat: v.lat,
        lng: v.lng,
        radiusKm: typeof v.radiusKm === "number" ? v.radiusKm : 50,
        label: typeof v.label === "string" ? v.label : undefined,
      };
    }
  } catch {
    /* corrupt JSON or storage unavailable — fall through to a blank location */
  }
  return null;
}

const location = ref<LocationValue>(
  loadStoredLocation() ?? { lat: null, lng: null, radiusKm: 50 },
);
const results = ref<Array<WithId<TradespersonDoc> & { distanceKm: number }>>([]);
// Seeded, unclaimed listings shown below the verified results ("Not yet
// verified"). (Exposing submitted-but-unapproved REAL tradespeople here is
// deferred until their sensitive fields move off the public doc.)
const prospectResults = ref<Array<WithId<ProspectDoc> & { distanceKm: number }>>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// Restore from the in-memory cache (kept live below) so navigating back from a
// profile shows the same results immediately — no refetch, no lost place.
// Arriving with ?q (a fresh search from the home hero) ignores the session
// cache so the newly-picked location actually re-runs the search instead of
// showing the previous result set.
if (searchCache.value && !route.query.q) {
  trade.value = searchCache.value.trade;
  results.value = searchCache.value.results;
  prospectResults.value = searchCache.value.prospectResults;
}

// --- Lazy rendering ---------------------------------------------------------
// Render the fetched results in pages so a long list doesn't all hit the DOM
// at once on mobile; an IntersectionObserver sentinel loads the next page as
// the user nears the bottom.
const PAGE_SIZE = 9;
const visibleCount = ref(searchCache.value?.visibleCount ?? PAGE_SIZE);
const visibleResults = computed(() => results.value.slice(0, visibleCount.value));
const visibleProspects = computed(() =>
  prospectResults.value.slice(0, Math.max(0, visibleCount.value - results.value.length)),
);
const hasMore = computed(
  () => visibleCount.value < results.value.length + prospectResults.value.length,
);

const sentinel = ref<HTMLElement | null>(null);
let io: IntersectionObserver | null = null;
watch(sentinel, (el) => {
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore.value) visibleCount.value += PAGE_SIZE;
      },
      { rootMargin: "400px" },
    );
  }
  io.disconnect();
  if (el) io.observe(el);
});

// Keep the cache live so a later remount restores the latest state.
watch([results, prospectResults, visibleCount, trade], () => {
  searchCache.value = {
    trade: trade.value,
    results: results.value,
    prospectResults: prospectResults.value,
    visibleCount: visibleCount.value,
  };
});

onUnmounted(() => io?.disconnect());

// Airbnb-style result pins for the map. Both verified members and seeded
// prospects carry a coarse `locationApprox`; skip any without one (e.g. an
// admin-grant profile that never set a location).
const mapMarkers = computed<AvatarMarkerData[]>(() => [
  ...results.value
    .filter((t) => t.locationApprox)
    .map((t) => ({
      id: t.id,
      lat: t.locationApprox.latitude,
      lng: t.locationApprox.longitude,
      photoURL: t.photoURL ?? null,
      initial: (t.displayName?.trim() || tradeLabel(t.trades[0] ?? "")).slice(0, 1),
      variant: "verified" as const,
    })),
  ...prospectResults.value
    .filter((p) => p.locationApprox)
    .map((p) => ({
      id: p.id,
      lat: p.locationApprox.latitude,
      lng: p.locationApprox.longitude,
      photoURL: p.photoURL ?? null,
      initial: (p.displayName?.trim() || tradeLabel(p.trades[0] ?? "")).slice(0, 1),
      variant: "prospect" as const,
    })),
]);

// Tapping a map pin opens that profile — same destination as the card.
function onMarkerClick(id: string) {
  router.push({ name: "TradieProfile", params: { uid: id } });
}

const AVAILABILITY_OPTIONS: { label: string; value: AvailabilityFilter }[] = [
  { label: "Any time", value: "any" },
  { label: "Today", value: "today" },
  { label: "This week", value: "this_week" },
];

async function search() {
  if (location.value.lat == null || location.value.lng == null) {
    error.value = 'Pick a location first — search an address or click "Use my location".';
    return;
  }
  error.value = null;
  // Carry the client's own words through to the request form so they don't
  // retype them after picking a tradesperson. Only when they actually
  // described something — a bare trade-filter search shouldn't pre-fill.
  if (describe.value.trim()) saveRequestPrefill(describe.value);
  loading.value = true;
  try {
    // Verified tradespeople + seeded prospects in parallel. Prospect search is
    // non-fatal — if it fails (e.g. index still building), the verified results
    // still render; prospects are supplementary.
    const geo = {
      trade: trade.value ?? undefined,
      centerLat: location.value.lat,
      centerLng: location.value.lng,
      radiusKm: location.value.radiusKm,
      limit: 50,
    };
    const [tradies, prospects] = await Promise.all([
      searchTradespeople({
        ...geo,
        minRating: minRating.value || undefined,
        availability: availability.value === "any" ? undefined : availability.value,
      }),
      searchProspects(geo).catch((e) => {
        console.warn("[search] prospect search failed", e);
        return [];
      }),
    ]);
    results.value = tradies;
    prospectResults.value = prospects;
    visibleCount.value = PAGE_SIZE; // reset paging for the new result set
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    loading.value = false;
  }
}

// Facebook-style location popup. The map lives inside a modal (not inline on
// the page) so it can't trap page scroll / trigger the mobile zoom. The page
// shows just a location field; tapping it opens the dialog with a DRAFT
// location, and "Apply" commits + re-searches.
const showLocationDialog = ref(false);
const draftLocation = ref<LocationValue>({ lat: null, lng: null, radiusKm: 50 });

function openLocationDialog() {
  draftLocation.value = { ...location.value };
  showLocationDialog.value = true;
}

function applyLocation() {
  location.value = { ...draftLocation.value };
  showLocationDialog.value = false;
  // Re-search explicitly — the auto-search watcher below only fires for the
  // initial seed (when there are no results yet).
  search();
}

// Auto-search whenever a location lands — including a location restored from
// localStorage or seeded from the account on mount (immediate: true), so the
// page renders results straight away instead of an empty shell.
watch(
  () => [location.value.lat, location.value.lng] as const,
  ([lat, lng]) => {
    if (lat != null && lng != null && results.value.length === 0) search();
  },
  { immediate: true },
);

// "N nearby" counts for the describe-box suggestion chips — one trade-agnostic
// area census (verified pros + seeded prospects), tallied by trade. Refreshed
// only when the LOCATION changes (not per keystroke); fully non-fatal, so any
// failure just leaves the chips without a number. Only positive counts render,
// so trades with nobody nearby simply aren't annotated.
const nearbyCounts = ref<Record<string, number>>({});
async function refreshNearbyCounts() {
  const { lat, lng, radiusKm } = location.value;
  if (lat == null || lng == null) return;
  const geo = { centerLat: lat, centerLng: lng, radiusKm };
  try {
    const [tradies, prospects] = await Promise.all([
      searchTradespeople(geo),
      searchProspects(geo).catch(() => []),
    ]);
    const counts: Record<string, number> = {};
    for (const p of [...tradies, ...prospects]) {
      for (const key of p.trades ?? []) counts[key] = (counts[key] ?? 0) + 1;
    }
    nearbyCounts.value = counts;
  } catch {
    /* non-fatal — chips just show no number */
  }
}
watch(
  () => [location.value.lat, location.value.lng, location.value.radiusKm] as const,
  ([lat, lng]) => {
    if (lat != null && lng != null) refreshNearbyCounts();
  },
  { immediate: true },
);

// Keep dropdown in sync if the URL query changes (e.g. tapping a different trade tile)
watch(
  () => route.query.trade,
  (q) => {
    trade.value = tradeFromQuery(q);
  },
);

// --- Sticky search location -----------------------------------------------
// Marketplace-style: never make the user re-pick where they're searching.
// Persist every resolved location, and on first visit (nothing stored) seed a
// sensible starting point so a signed-in user doesn't face a blank slate.

function hasLocation(l: LocationValue): boolean {
  return l.lat != null && l.lng != null;
}

// Mirror the location to localStorage on every change so it sticks across
// visits. Guarded so a half-set value never overwrites a good stored one.
watch(
  location,
  (l) => {
    if (!hasLocation(l)) return;
    try {
      localStorage.setItem(SEARCH_LOCATION_KEY, JSON.stringify(l));
    } catch {
      /* quota / private mode — non-fatal, we just don't persist this time */
    }
  },
  { deep: true },
);

// Seed from a signed-in tradesperson's saved service location (exact point +
// label live in the owner-only private contact subdoc). Returns true if it set
// a location. Clients (no tradie profile) and permission errors fall through.
async function seedFromAccount(uid: string): Promise<boolean> {
  try {
    const contact = await getTradespersonContact(uid);
    const point = contact?.location;
    if (!point) return false;
    location.value = {
      lat: point.latitude,
      lng: point.longitude,
      radiusKm: location.value.radiusKm,
      label: contact?.primaryAddressText || undefined,
    };
    return true;
  } catch {
    return false;
  }
}

// Whether the browser already has geolocation permission, without prompting.
// Drives the precise-vs-coarse fallback choice below.
async function geolocationAlreadyGranted(): Promise<boolean> {
  if (!navigator.geolocation || !navigator.permissions) return false;
  try {
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    });
    return status.state === "granted";
  } catch {
    return false; // Permissions API doesn't support geolocation here
  }
}

// Coarse region from the visitor's IP — the no-prompt last resort so a
// first-time / logged-out visitor still lands on a search centred near them.
// Best-effort: a null result (offline/blocked) just leaves the picker empty.
async function seedFromIpRegion(): Promise<void> {
  const region = await lookupIpRegion();
  if (!region || hasLocation(location.value)) return;
  location.value = {
    lat: region.lat,
    lng: region.lng,
    radiusKm: location.value.radiusKm,
    label: region.label,
  };
}

// Use the device location ONLY when permission was already granted — so a
// first-time / logged-out visitor never gets an unprompted browser GPS dialog.
// The explicit "Use my location" button in LocationPicker covers the opt-in.
async function seedFromGeolocationIfGranted(): Promise<void> {
  if (!navigator.geolocation || !navigator.permissions) return;
  try {
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    });
    if (status.state !== "granted") return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        location.value = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          radiusKm: location.value.radiusKm,
          label: "Current location",
        };
      },
      () => {
        /* permission revoked between query and read — ignore */
      },
    );
  } catch {
    /* Permissions API doesn't support geolocation here — skip silently */
  }
}

// --- Saved tradespeople ------------------------------------------------------
// Signed-in users get a heart on every card plus a "Saved" shelf above the
// results. The id-set subscription keeps hearts live across devices; the shelf
// hydrates profiles lazily and silently drops tradies who went invisible.
const toast = useToast();
const savedIds = ref<Set<string>>(new Set());
const savedTradies = ref<WithId<TradespersonDoc>[]>([]);
let unsubSaved: (() => void) | null = null;

watch(
  () => auth.fbUser?.uid,
  (uid) => {
    unsubSaved?.();
    unsubSaved = null;
    savedIds.value = new Set();
    savedTradies.value = [];
    if (!uid) return;
    unsubSaved = subscribeSavedTradieIds(uid, (ids) => {
      savedIds.value = ids;
      hydrateSavedTradies([...ids])
        .then((docs) => (savedTradies.value = docs))
        .catch(() => {
          /* shelf is best-effort; hearts still work off savedIds */
        });
    });
  },
  { immediate: true },
);
onUnmounted(() => unsubSaved?.());

async function onToggleSave(tradieId: string) {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  try {
    if (savedIds.value.has(tradieId)) await unsaveTradie(uid, tradieId);
    else await saveTradie(uid, tradieId);
  } catch (e) {
    toast.error("Couldn't update your saved list", humanizeError(e));
  }
}

// --- Empty-state copy -------------------------------------------------------
// Once a location is set the page always runs a search (the immediate
// auto-search watcher above), so "location set + not loading + zero hits"
// means "searched and found nobody" — not "haven't searched yet". The old
// single message ("No results yet. Set a location and search.") told users to
// set a location they'd already set. Split the two states, and when a real
// search comes up empty, name the gap and nudge them to help fill it.
// Curated plural noun for the selected trade ("home inspectors", "HVAC techs")
// — see tradePlural / the searchPlural field. Null when no trade filter is set,
// so the copy falls back to the generic "tradespeople".
const selectedTradePlural = computed(() => (trade.value ? tradePlural(trade.value) : null));
const areaLabel = computed(() => location.value.label || "this area");
const invitePlural = computed(() => selectedTradePlural.value ?? "tradespeople");
const noResultsHeading = computed(() =>
  selectedTradePlural.value
    ? `No "${selectedTradePlural.value}" are signed up in ${areaLabel.value} yet.`
    : `No tradespeople are signed up in ${areaLabel.value} yet.`,
);

// Blue Seal grows by word of mouth — when a search comes up empty, let the
// client invite a tradesperson they rate. Native share sheet on mobile,
// clipboard fallback on desktop. A cancelled share sheet throws AbortError;
// swallow it so it never surfaces as an error toast.
async function inviteTradesperson() {
  const url = window.location.origin;
  const text = `I'm looking for ${invitePlural.value} on Blue Seal — verified trades near ${areaLabel.value}. Join and get verified:`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Blue Seal", text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast.success("Invite link copied", "Send it to a tradesperson you'd recommend.");
  } catch {
    /* share sheet cancelled or clipboard blocked — nothing to report */
  }
}

onMounted(async () => {
  // localStorage already hydrated `location` at setup and the immediate
  // auto-search watcher has it covered — nothing left to resolve.
  if (hasLocation(location.value)) return;
  // Public route: wait for auth to settle before reading the signed-in user.
  await auth.init();
  const uid = auth.fbUser?.uid;
  if (uid && (await seedFromAccount(uid))) return;
  // Last resort, no permission prompt either way: precise device location when
  // it's already permitted, otherwise a coarse IP-based region.
  if (await geolocationAlreadyGranted()) {
    await seedFromGeolocationIfGranted();
  } else {
    await seedFromIpRegion();
  }
});
</script>

<template>
  <section class="bs-container py-6">
    <h1 class="text-2xl font-bold">Find a tradesperson</h1>
    <p class="mb-4 text-[color:var(--bs-muted)]">
      Verified, near you, sorted by distance.
    </p>

    <div class="bs-card bs-form mb-4 p-4">
      <!-- Describe-what-you-need: plain-English → suggested trades, so clients
           who don't know the trade name don't have to scroll the dropdown. -->
      <TradeDescribeBox
        v-model="describe"
        :active-key="trade"
        :counts="nearbyCounts"
        no-match-hint="No trade matched that yet — try different words, pick one below, or just search your area."
        @select="applySuggestion"
      />

      <div class="bs-describe-divider my-4"><span>or filter by trade</span></div>

      <div class="grid items-end gap-3 sm:grid-cols-3">
        <div>
          <label class="text-xs font-medium">Trade</label>
          <Select
            v-model="trade"
            :options="TRADES"
            option-label="label"
            option-value="key"
            placeholder="Any"
            show-clear
            class="mt-1 w-full"
          />
        </div>
        <div>
          <label class="text-xs font-medium">Available</label>
          <Select
            v-model="availability"
            :options="AVAILABILITY_OPTIONS"
            option-label="label"
            option-value="value"
            class="mt-1 w-full"
          />
        </div>
        <div>
          <label class="text-xs font-medium">Min rating</label>
          <Rating v-model="minRating" :cancel="true" class="mt-2" />
        </div>
      </div>

      <div class="mt-3">
        <label class="text-xs font-medium">Location</label>
        <button type="button" class="bs-location-field mt-1" @click="openLocationDialog">
          <i class="pi pi-map-marker text-[color:var(--bs-muted)]" aria-hidden="true"></i>
          <span v-if="hasLocation(location)" class="min-w-0 flex-1 truncate text-left">
            {{ location.label || "Selected area" }}
            <span class="text-[color:var(--bs-muted)]">· {{ location.radiusKm }} km</span>
          </span>
          <span v-else class="flex-1 text-left text-[color:var(--bs-muted)]">
            Set location
          </span>
          <i class="pi pi-pencil text-xs text-[color:var(--bs-blue)]" aria-hidden="true"></i>
        </button>
      </div>

      <div class="mt-4 sm:flex sm:justify-end">
        <Button
          label="Search"
          icon="pi pi-search"
          :loading="loading"
          class="w-full sm:w-auto"
          @click="search"
        />
      </div>
    </div>

    <!-- Location picker popup (Facebook-style). The map is contained here so it
         never interferes with page scroll / the fixed bottom bar. -->
    <Dialog
      v-model:visible="showLocationDialog"
      modal
      header="Change location"
      :style="{ width: '34rem', maxWidth: '94vw' }"
      :dismissable-mask="true"
    >
      <p class="mb-3 text-sm text-[color:var(--bs-muted)]">
        Search by city, neighbourhood or postal code — or drop the pin on the map.
      </p>
      <LocationPicker
        v-model="draftLocation"
        :markers="mapMarkers"
        gesture="greedy"
        @marker-click="onMarkerClick"
      />
      <template #footer>
        <Button label="Cancel" text @click="showLocationDialog = false" />
        <Button
          label="Apply"
          icon="pi pi-check"
          :disabled="!hasLocation(draftLocation)"
          @click="applyLocation"
        />
      </template>
    </Dialog>

    <Message v-if="error" severity="warn" :closable="false" class="mb-3">
      {{ error }}
    </Message>

    <!-- Saved shelf: the user's shortlist, always above search results so a
         returning client can jump straight back to "that one I liked". -->
    <section v-if="savedTradies.length" class="mb-5">
      <h2 class="text-base font-semibold">
        <i class="pi pi-heart-fill mr-1 text-[color:var(--bs-red)]"></i>
        Saved tradespeople
      </h2>
      <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TradieCard
          v-for="t in savedTradies"
          :key="t.id"
          :tradie="t"
          :saved="true"
          @toggle-save="onToggleSave(t.id)"
        />
      </div>
    </section>

    <LoadingState v-if="loading" label="Searching…" />
    <template v-else>
      <div
        v-if="!results.length && !prospectResults.length"
        class="bs-empty"
      >
        <i class="pi pi-search mb-2 block text-3xl"></i>
        <!-- No location yet → prompt to search. Location set (so a search has
             already run) but nothing came back → name the gap + invite. -->
        <p v-if="location.lat == null">No results yet. Set a location and search.</p>
        <template v-else>
          <p class="font-medium">{{ noResultsHeading }}</p>
          <p class="mx-auto mt-1 max-w-sm text-sm">
            Blue Seal is still growing here. Know any great {{ invitePlural }}
            you'd recommend? Invite them to get verified.
          </p>
          <Button
            class="mt-3"
            label="Invite a tradesperson"
            icon="pi pi-send"
            outlined
            size="small"
            @click="inviteTradesperson"
          />
        </template>
      </div>
      <template v-else>
        <div v-if="visibleResults.length" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TradieCard
            v-for="t in visibleResults"
            :key="t.id"
            :tradie="t"
            :saved="auth.fbUser ? savedIds.has(t.id) : undefined"
            @toggle-save="onToggleSave(t.id)"
          />
        </div>

        <!-- Seeded, unclaimed listings — clearly separated below the verified
             results so they never outrank a vetted tradesperson, and labelled
             "not yet verified" so clients aren't misled. -->
        <section v-if="visibleProspects.length" class="mt-6">
          <h2 class="text-lg font-semibold">Unclaimed listings</h2>
          <p class="mb-3 text-sm text-[color:var(--bs-muted)]">
            Blue Seal added these from public business info — they haven't joined or been verified yet.
          </p>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ProspectCard v-for="p in visibleProspects" :key="p.id" :prospect="p" />
          </div>
        </section>

        <!-- Infinite-scroll sentinel: renders the next page as it nears view. -->
        <div
          v-if="hasMore"
          ref="sentinel"
          class="py-4 text-center text-sm text-[color:var(--bs-muted)]"
        >
          <i class="pi pi-spin pi-spinner mr-1"></i> Loading more…
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
/* Location field — looks like the other form inputs but acts as a button that
   opens the location popup. */
.bs-location-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--bs-border);
  border-radius: 6px;
  background: #fff;
  font-size: 0.9375rem;
  cursor: pointer;
  transition: border-color 120ms ease;
}
.bs-location-field:hover {
  border-color: var(--bs-blue);
}
.bs-location-field:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: 1px;
}

/* "or filter by trade" rule. */
.bs-describe-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--bs-muted);
}
.bs-describe-divider::before,
.bs-describe-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--bs-border);
}
</style>
