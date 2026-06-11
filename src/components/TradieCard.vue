<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import Avatar from "primevue/avatar";
import Tag from "primevue/tag";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";
import VerifiedBadge from "@/components/VerifiedBadge.vue";

const props = defineProps<{
  tradie: WithId<TradespersonDoc> & { distanceKm?: number };
  // Tri-state: leave undefined to hide the heart entirely (e.g. signed-out
  // visitors); boolean renders it in the matching state.
  saved?: boolean;
}>();

const emit = defineEmits<{
  "toggle-save": [];
}>();

const { money } = useFormatters();

const avatarInitial = computed(() => {
  const name = props.tradie.displayName?.trim() || tradeLabel(props.tradie.trades[0] ?? "");
  return name.slice(0, 1).toUpperCase() || "?";
});

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
      <Avatar
        v-if="props.tradie.photoURL"
        :image="props.tradie.photoURL"
        size="large"
        shape="circle"
      />
      <Avatar
        v-else
        :label="avatarInitial"
        size="large"
        shape="circle"
        style="background-color: var(--bs-blue); color: white; font-weight: 600;"
      />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="font-semibold truncate min-w-0 max-w-full">
            {{ props.tradie.displayName?.trim() || tradeLabel(props.tradie.trades[0]) }}
          </span>
          <Tag v-if="props.tradie.idVerified" value="ID verified" severity="success" />
          <VerifiedBadge
            v-if="insuranceLive"
            kind="insurance"
            :expires-at="props.tradie.insuranceExpiresAt"
          />
          <VerifiedBadge
            v-if="wsibLive"
            kind="wsib"
            :expires-at="props.tradie.wsibExpiresAt"
          />
        </div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-0.5 break-words">
          {{ props.tradie.trades.map(tradeLabel).join(" • ") }}
        </div>
      </div>
      <!-- Heart sits inside the RouterLink card, so stop/prevent keeps a tap
           from navigating. Padded to a finger-sized target. -->
      <button
        v-if="props.saved !== undefined"
        type="button"
        class="bs-save-heart -m-2 shrink-0"
        :class="{ 'bs-save-heart--on': props.saved }"
        :aria-label="props.saved ? 'Remove from saved' : 'Save tradesperson'"
        :aria-pressed="props.saved"
        @click.stop.prevent="emit('toggle-save')"
      >
        <i :class="props.saved ? 'pi pi-heart-fill' : 'pi pi-heart'" aria-hidden="true"></i>
      </button>
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

<style scoped>
.bs-save-heart {
  padding: 0.5rem;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--bs-muted);
  font-size: 1rem;
  line-height: 1;
  border-radius: 9999px;
  transition: color 120ms ease, transform 120ms ease;
}
.bs-save-heart:hover {
  color: var(--bs-red, var(--bs-danger));
}
.bs-save-heart--on {
  color: var(--bs-red, var(--bs-danger));
}
.bs-save-heart:active {
  transform: scale(1.15);
}
</style>
