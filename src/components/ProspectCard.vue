<script setup lang="ts">
// Search-result card for a seeded prospect. Deliberately the TradieCard layout
// MINUS every trust element (ID/insurance/WSIB badges, rating, verified-trade
// pills) — a seeded listing is unclaimed + unvetted, so the only status it
// shows is a "Pending verification" tag. Prospects also have no photoURL, so
// the avatar is always the initial, in a muted (non-brand-blue) colour to read
// as "not yet a member".
import { computed } from "vue";
import { RouterLink } from "vue-router";
import Avatar from "primevue/avatar";
import Tag from "primevue/tag";
import type { ProspectDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";

const props = defineProps<{
  prospect: WithId<ProspectDoc> & { distanceKm?: number };
}>();
const { money } = useFormatters();

const avatarInitial = computed(() => {
  const name =
    props.prospect.displayName?.trim() || tradeLabel(props.prospect.trades[0] ?? "");
  return name.slice(0, 1).toUpperCase() || "?";
});
</script>

<template>
  <RouterLink
    :to="{ name: 'TradieProfile', params: { uid: props.prospect.id } }"
    class="bs-card p-4 hover:shadow-md transition-shadow no-underline text-inherit block"
  >
    <div class="flex items-start gap-3">
      <!-- Logo fit-to-circle: `contain` so non-square company logos aren't
           stretched; a white background fills the letterboxed area. -->
      <div
        v-if="props.prospect.photoURL"
        class="prospect-logo prospect-logo--lg"
        role="img"
        :aria-label="props.prospect.displayName"
        :style="{ backgroundImage: `url('${props.prospect.photoURL}')` }"
      ></div>
      <Avatar
        v-else
        :label="avatarInitial"
        size="large"
        shape="circle"
        style="background-color: var(--bs-muted); color: white; font-weight: 600;"
      />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="font-semibold truncate min-w-0 max-w-full">
            {{ props.prospect.displayName?.trim() || tradeLabel(props.prospect.trades[0]) }}
          </span>
          <Tag value="Unverified" severity="warn" />
        </div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-0.5 break-words">
          {{ props.prospect.trades.map(tradeLabel).join(" • ") }}
        </div>
        <div
          v-if="props.prospect.locationLabel"
          class="text-xs text-[color:var(--bs-muted)] mt-0.5"
        >
          <i class="pi pi-map-marker text-[10px]"></i> {{ props.prospect.locationLabel }}
        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2 mt-3 text-sm">
      <div>
        <div class="text-xs text-[color:var(--bs-muted)]">Rate</div>
        <div class="font-medium">
          {{ props.prospect.hourlyRate ? money(props.prospect.hourlyRate) + "/hr" : "Quote" }}
        </div>
      </div>
      <div v-if="props.prospect.distanceKm != null">
        <div class="text-xs text-[color:var(--bs-muted)]">Distance</div>
        <div class="font-medium">{{ props.prospect.distanceKm.toFixed(1) }} km</div>
      </div>
    </div>
  </RouterLink>
</template>

<style scoped>
.prospect-logo {
  flex: none;
  border-radius: 9999px;
  background-color: #fff;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  border: 1px solid var(--bs-border);
}
.prospect-logo--lg {
  width: 3rem;
  height: 3rem;
}
</style>
