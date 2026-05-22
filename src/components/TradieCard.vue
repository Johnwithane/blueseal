<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import Tag from "primevue/tag";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";

const props = defineProps<{
  tradie: WithId<TradespersonDoc> & { distanceKm?: number };
}>();
const { money } = useFormatters();

// Trust-badge visibility checks. Both auto-hide once expiresAt passes so an
// admin doesn't need to revoke the badge manually when an insurance policy
// or WSIB clearance lapses — the tradie just re-uploads and the badge
// comes back on re-approval.
const now = Date.now();
const insuranceLive = computed(() => {
  if (!props.tradie.insuranceVerified) return false;
  const exp = props.tradie.insuranceExpiresAt?.toDate?.().getTime();
  return exp == null || exp > now;
});
const wsibLive = computed(() => {
  if (!props.tradie.wsibVerified) return false;
  const exp = props.tradie.wsibExpiresAt?.toDate?.().getTime();
  return exp == null || exp > now;
});
</script>

<template>
  <RouterLink
    :to="{ name: 'TradieProfile', params: { uid: props.tradie.id } }"
    class="bs-card p-4 hover:shadow-md transition-shadow no-underline text-inherit block"
  >
    <div class="flex items-start gap-3">
      <div class="h-12 w-12 rounded-full bg-[color:var(--bs-blue)] text-white flex items-center justify-center font-semibold text-lg">
        {{ props.tradie.id.slice(0, 1).toUpperCase() }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="font-semibold truncate">{{ tradeLabel(props.tradie.trades[0]) }}</span>
          <Tag v-if="props.tradie.idVerified" value="ID verified" severity="success" />
          <Tag v-if="insuranceLive" value="Insured" severity="info" />
          <Tag v-if="wsibLive" value="WSIB" severity="info" />
        </div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
          {{ props.tradie.trades.map(tradeLabel).join(" • ") }}
        </div>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-2 mt-3 text-sm">
      <div>
        <div class="text-xs text-[color:var(--bs-muted)]">Rating</div>
        <div class="font-medium">
          {{ props.tradie.ratingCount ? props.tradie.ratingAvg.toFixed(1) : "—" }}
          <span class="text-xs text-[color:var(--bs-muted)]">({{ props.tradie.ratingCount }})</span>
        </div>
      </div>
      <div>
        <div class="text-xs text-[color:var(--bs-muted)]">Rate</div>
        <div class="font-medium">
          {{ props.tradie.hourlyRate ? money(props.tradie.hourlyRate) + "/hr" : "Quote" }}
        </div>
      </div>
      <div v-if="props.tradie.distanceKm != null">
        <div class="text-xs text-[color:var(--bs-muted)]">Distance</div>
        <div class="font-medium">{{ props.tradie.distanceKm.toFixed(1) }} km</div>
      </div>
    </div>

    <div class="flex flex-wrap gap-1 mt-3">
      <span v-for="t in props.tradie.verifiedTrades" :key="t" class="bs-pill verified">
        <i class="pi pi-verified"></i>{{ tradeLabel(t) }}
      </span>
    </div>
  </RouterLink>
</template>
