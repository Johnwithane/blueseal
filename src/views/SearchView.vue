<script setup lang="ts">
import { ref, watch } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import Rating from "primevue/rating";
import Message from "primevue/message";
import { searchTradespeople } from "@/firebase/services/tradespeople";
import { TRADES } from "@/data/trades";
import TradieCard from "@/components/TradieCard.vue";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";

const trade = ref<string | null>(null);
const minRating = ref(0);
const lat = ref<number | null>(null);
const lng = ref<number | null>(null);
const radiusKm = ref(50);
const results = ref<Array<WithId<TradespersonDoc> & { distanceKm: number }>>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function useMyLocation() {
  if (!navigator.geolocation) {
    error.value = "Geolocation is not available in this browser.";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lat.value = pos.coords.latitude;
      lng.value = pos.coords.longitude;
    },
    (err) => (error.value = err.message),
  );
}

async function search() {
  if (lat.value == null || lng.value == null) {
    error.value = "Pick a location first (use \"Use my location\" or paste lat/lng).";
    return;
  }
  error.value = null;
  loading.value = true;
  try {
    results.value = await searchTradespeople({
      trade: trade.value ?? undefined,
      centerLat: lat.value,
      centerLng: lng.value,
      radiusKm: radiusKm.value,
      minRating: minRating.value || undefined,
      limit: 50,
    });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

// Auto-search when location lands
watch([lat, lng], () => {
  if (lat.value != null && lng.value != null && results.value.length === 0) search();
});
</script>

<template>
  <section class="bs-container py-6">
    <h1 class="text-2xl font-bold">Find a tradie</h1>
    <p class="text-[color:var(--bs-muted)] mb-4">
      Verified, near you, sorted by distance.
    </p>

    <div class="bs-card p-4 mb-4 bs-form grid sm:grid-cols-5 gap-3 items-end">
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
        <label class="text-xs font-medium">Min rating</label>
        <Rating v-model="minRating" :cancel="true" class="mt-2" />
      </div>
      <div>
        <label class="text-xs font-medium">Latitude</label>
        <InputNumber v-model="lat" :min-fraction-digits="4" :max-fraction-digits="6" class="mt-1 w-full" />
      </div>
      <div>
        <label class="text-xs font-medium">Longitude</label>
        <InputNumber v-model="lng" :min-fraction-digits="4" :max-fraction-digits="6" class="mt-1 w-full" />
      </div>
      <div>
        <label class="text-xs font-medium">Radius: {{ radiusKm }} km</label>
        <InputText :model-value="String(radiusKm)" type="number" class="mt-1" @update:model-value="(v) => (radiusKm = Number(v) || 0)" />
      </div>
      <div class="sm:col-span-5 flex gap-2 justify-between flex-wrap">
        <Button label="Use my location" icon="pi pi-map-marker" outlined @click="useMyLocation" />
        <Button label="Search" icon="pi pi-search" :loading="loading" @click="search" />
      </div>
    </div>

    <Message v-if="error" severity="warn" :closable="false" class="mb-3">{{ error }}</Message>

    <div v-if="loading" class="bs-empty">Searching…</div>
    <div v-else-if="!results.length" class="bs-empty">
      <i class="pi pi-search text-3xl mb-2 block"></i>
      <p>No results yet. Set a location and search.</p>
    </div>
    <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <TradieCard v-for="t in results" :key="t.id" :tradie="t" />
    </div>
  </section>
</template>
