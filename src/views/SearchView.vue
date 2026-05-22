<script setup lang="ts">
import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import Button from "primevue/button";
import Select from "primevue/select";
import Rating from "primevue/rating";
import Message from "primevue/message";
import { searchTradespeople, type AvailabilityFilter } from "@/firebase/services/tradespeople";
import { TRADES } from "@/data/trades";
import TradieCard from "@/components/TradieCard.vue";
import LocationPicker, {
  type LocationValue,
} from "@/components/LocationPicker.vue";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";

const route = useRoute();

function tradeFromQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return TRADES.some((t) => t.key === value) ? value : null;
}

const trade = ref<string | null>(tradeFromQuery(route.query.trade));
const minRating = ref(0);
const availability = ref<AvailabilityFilter>("any");
const location = ref<LocationValue>({
  lat: null,
  lng: null,
  radiusKm: 50,
});
const results = ref<Array<WithId<TradespersonDoc> & { distanceKm: number }>>([]);
const loading = ref(false);
const error = ref<string | null>(null);

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
    results.value = await searchTradespeople({
      trade: trade.value ?? undefined,
      centerLat: location.value.lat,
      centerLng: location.value.lng,
      radiusKm: location.value.radiusKm,
      minRating: minRating.value || undefined,
      availability: availability.value === "any" ? undefined : availability.value,
      limit: 50,
    });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

// Auto-search the first time a location lands
watch(
  () => [location.value.lat, location.value.lng] as const,
  ([lat, lng]) => {
    if (lat != null && lng != null && results.value.length === 0) search();
  },
);

// Keep dropdown in sync if the URL query changes (e.g. tapping a different trade tile)
watch(
  () => route.query.trade,
  (q) => {
    trade.value = tradeFromQuery(q);
  },
);
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
        <LocationPicker v-model="location" />
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
    <div v-else-if="!results.length" class="bs-empty">
      <i class="pi pi-search mb-2 block text-3xl"></i>
      <p>No results yet. Set a location and search.</p>
    </div>
    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <TradieCard v-for="t in results" :key="t.id" :tradie="t" />
    </div>
  </section>
</template>
