<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import { useAuthStore } from "@/stores/auth";
import {
  subscribeSavedTradieIds,
  hydrateSavedTradies,
  unsaveTradie,
} from "@/firebase/services/savedTradies";
import { tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import InitialsAvatar from "@/components/InitialsAvatar.vue";

// The signed-in user's saved tradespeople (the existing `savedTradies` shortlist),
// surfaced as a re-hire list. Universal for clients; for a project manager this is
// their preferred contractors. Save/unsave happens from the tradesperson profile.
const auth = useAuthStore();
const toast = useToast();

const loading = ref(true);
const tradies = ref<WithId<TradespersonDoc>[]>([]);
let unsub: (() => void) | null = null;

function tradesText(t: WithId<TradespersonDoc>): string {
  const ts = t.trades ?? [];
  if (ts.length === 0) return "Tradesperson";
  const labels = ts.map((k) => tradeLabel(k));
  return labels.slice(0, 2).join(", ") + (labels.length > 2 ? ` +${labels.length - 2}` : "");
}

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) {
    loading.value = false;
    return;
  }
  unsub = subscribeSavedTradieIds(uid, async (ids) => {
    tradies.value = await hydrateSavedTradies([...ids]);
    loading.value = false;
  });
});
onUnmounted(() => unsub?.());

async function remove(id: string): Promise<void> {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  try {
    await unsaveTradie(uid, id);
  } catch (e) {
    toast.error(humanizeError(e));
  }
}
</script>

<template>
  <div>
    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)] py-6 text-center">Loading…</div>
    <div v-else-if="tradies.length === 0" class="bs-card p-6 text-center">
      <i class="pi pi-bookmark text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">No saved trades yet</p>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Save tradespeople you trust from their profile, then re-hire them here in one tap.
      </p>
    </div>
    <ul v-else class="grid grid-cols-1 gap-2">
      <li v-for="t in tradies" :key="t.id" class="bs-card p-3 flex items-center gap-3">
        <InitialsAvatar :name="t.displayName" :photo-url="t.photoURL" :size="40" tone="solid" />
        <div class="min-w-0 flex-1">
          <p class="font-medium truncate">{{ t.displayName ?? "Tradesperson" }}</p>
          <p class="text-xs text-[color:var(--bs-muted)] truncate">{{ tradesText(t) }}</p>
        </div>
        <RouterLink :to="{ name: 'RequestQuote', params: { uid: t.id } }">
          <Button label="Request" icon="pi pi-send" size="small" />
        </RouterLink>
        <Button
          icon="pi pi-times"
          text
          rounded
          severity="secondary"
          aria-label="Remove from saved trades"
          @click="remove(t.id)"
        />
      </li>
    </ul>
  </div>
</template>
