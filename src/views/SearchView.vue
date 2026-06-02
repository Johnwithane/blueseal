<script setup lang="ts">
import { ref, watch, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import Select from "primevue/select";
import Rating from "primevue/rating";
import Message from "primevue/message";
import {
  searchTradespeople,
  getTradespersonContact,
  type AvailabilityFilter,
} from "@/firebase/services/tradespeople";
import { searchProspects } from "@/firebase/services/prospects";
import { useAuthStore } from "@/stores/auth";
import { TRADES, tradeLabel } from "@/data/trades";
import type { AvatarMarkerData } from "@/utils/avatarMarker";
import TradieCard from "@/components/TradieCard.vue";
import ProspectCard from "@/components/ProspectCard.vue";
import LocationPicker, {
  type LocationValue,
} from "@/components/LocationPicker.vue";
import type { ProspectDoc, TradespersonDoc, WithId } from "@/firebase/interfaces";

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
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
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

onMounted(async () => {
  // localStorage already hydrated `location` at setup and the immediate
  // auto-search watcher has it covered — nothing left to resolve.
  if (hasLocation(location.value)) return;
  // Public route: wait for auth to settle before reading the signed-in user.
  await auth.init();
  const uid = auth.fbUser?.uid;
  if (uid && (await seedFromAccount(uid))) return;
  // Last resort: device location, but only if already permitted.
  await seedFromGeolocationIfGranted();
});
</script>

<template>
  <section class="bs-container py-6">
    <h1 class="text-2xl font-bold">Find a tradesperson</h1>
    <p class="mb-4 text-[color:var(--bs-muted)]">
      Verified, near you, sorted by distance.
    </p>

    <div class="bs-card bs-form mb-4 p-4">
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

      <div class="mt-4">
        <LocationPicker
          v-model="location"
          :markers="mapMarkers"
          @marker-click="onMarkerClick"
        />
      </div>

      <div class="mt-4 flex justify-end">
        <Button
          label="Search"
          icon="pi pi-search"
          :loading="loading"
          @click="search"
        />
      </div>
    </div>

    <Message v-if="error" severity="warn" :closable="false" class="mb-3">
      {{ error }}
    </Message>

    <div v-if="loading" class="bs-empty">Searching…</div>
    <template v-else>
      <div
        v-if="!results.length && !prospectResults.length"
        class="bs-empty"
      >
        <i class="pi pi-search mb-2 block text-3xl"></i>
        <p>No results yet. Set a location and search.</p>
      </div>
      <template v-else>
        <div v-if="results.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TradieCard v-for="t in results" :key="t.id" :tradie="t" />
        </div>

        <!-- Seeded, unclaimed listings — clearly separated below the verified
             results so they never outrank a vetted tradesperson, and labelled
             "not yet verified" so clients aren't misled. -->
        <section v-if="prospectResults.length" class="mt-6">
          <h2 class="text-lg font-semibold">Unverified tradespeople</h2>
          <p class="mb-3 text-sm text-[color:var(--bs-muted)]">
            These tradespeople haven't been verified by Blue Seal yet.
          </p>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ProspectCard v-for="p in prospectResults" :key="p.id" :prospect="p" />
          </div>
        </section>
      </template>
    </template>
  </section>
</template>
