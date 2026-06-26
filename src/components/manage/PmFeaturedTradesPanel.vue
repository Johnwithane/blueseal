<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import ToggleSwitch from "primevue/toggleswitch";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { subscribeSavedTradieIds, hydrateSavedTradies } from "@/firebase/services/savedTradies";
import { subscribePmProfile, setFeaturedContractor } from "@/firebase/services/pmProfile";
import { tradeLabel } from "@/data/trades";
import type { ProjectManagerProfileDoc, TradespersonDoc, WithId } from "@/firebase/interfaces";

// P5b featuring UI: pick which of the PM's saved trades appear on their public
// profile. Each toggle calls setFeaturedContractor (server denormalizes + notifies +
// respects the contractor's opt-out). The set of currently-featured ids comes from
// the public profile doc's featuredContractors (server-managed).
const auth = useAuthStore();
const toast = useToast();

const tradies = ref<WithId<TradespersonDoc>[]>([]);
const profile = ref<WithId<ProjectManagerProfileDoc> | null>(null);
const loading = ref(true);
const busy = ref<string | null>(null);
let unsubSaved: (() => void) | null = null;
let unsubProfile: (() => void) | null = null;

const featuredIds = computed(
  () => new Set((profile.value?.featuredContractors ?? []).map((c) => c.tradieId)),
);

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) {
    loading.value = false;
    return;
  }
  unsubSaved = subscribeSavedTradieIds(uid, async (ids) => {
    tradies.value = await hydrateSavedTradies([...ids]);
    loading.value = false;
  });
  unsubProfile = subscribePmProfile(uid, (p) => (profile.value = p));
});
onUnmounted(() => {
  unsubSaved?.();
  unsubProfile?.();
});

function tradesText(t: WithId<TradespersonDoc>): string {
  const ts = (t.trades ?? []).map((k) => tradeLabel(k));
  return ts.slice(0, 2).join(", ") + (ts.length > 2 ? ` +${ts.length - 2}` : "");
}

async function toggle(t: WithId<TradespersonDoc>, next: boolean) {
  busy.value = t.id;
  try {
    await setFeaturedContractor(t.id, next);
    toast.success(next ? "Featured" : "Removed", next ? `${t.displayName ?? "They"} now appear on your profile.` : "");
  } catch (e) {
    toast.error("Couldn't update", humanizeError(e));
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div>
    <p v-if="!profile" class="text-sm text-[color:var(--bs-muted)] mb-2">
      Set up your profile above first, then choose which trades to feature.
    </p>

    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)] py-4 text-center">Loading…</div>
    <div v-else-if="tradies.length === 0" class="bs-card p-5 text-center">
      <i class="pi pi-users text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">No saved trades yet</p>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Save tradespeople in the Trades tab, then feature them here.
      </p>
    </div>
    <ul v-else class="grid grid-cols-1 gap-2">
      <li v-for="t in tradies" :key="t.id" class="bs-card p-3 flex items-center gap-3">
        <img v-if="t.photoURL" :src="t.photoURL" alt="" class="w-9 h-9 rounded-full object-cover shrink-0" />
        <span
          v-else
          class="w-9 h-9 rounded-full bg-[color:var(--bs-blue)] text-white grid place-items-center shrink-0"
        >{{ (t.displayName ?? "?").charAt(0).toUpperCase() }}</span>
        <div class="min-w-0 flex-1">
          <p class="font-medium truncate">{{ t.displayName ?? "Tradesperson" }}</p>
          <p class="text-xs text-[color:var(--bs-muted)] truncate">{{ tradesText(t) }}</p>
        </div>
        <span class="text-xs text-[color:var(--bs-muted)]">Featured</span>
        <ToggleSwitch
          :model-value="featuredIds.has(t.id)"
          :disabled="busy === t.id || !profile"
          @update:model-value="(v) => toggle(t, v)"
        />
      </li>
    </ul>
  </div>
</template>
