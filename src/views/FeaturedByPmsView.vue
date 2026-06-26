<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import Button from "primevue/button";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import {
  subscribeFeaturedByPms,
  setPmFeatureOptOut,
  type FeaturedByPm,
} from "@/firebase/services/pmProfile";

// The contractor's view of which project managers feature them on a public profile,
// with a Remove (opt-out) action. Linked from the pm_featured notification.
const auth = useAuthStore();
const toast = useToast();
useSeo({ title: "Featured by", noindex: true });

const rows = ref<FeaturedByPm[]>([]);
const loading = ref(true);
const busy = ref<string | null>(null);
let unsub: (() => void) | null = null;

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) {
    loading.value = false;
    return;
  }
  unsub = subscribeFeaturedByPms(uid, (r) => {
    rows.value = r;
    loading.value = false;
  });
});
onUnmounted(() => unsub?.());

async function optOut(pm: FeaturedByPm) {
  busy.value = pm.id;
  try {
    await setPmFeatureOptOut(pm.id, true);
    toast.success("Removed", `You've been removed from ${pm.pmName ?? "their"} profile.`);
  } catch (e) {
    toast.error("Couldn't update", humanizeError(e));
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <section class="bs-container py-8 max-w-2xl">
    <h1 class="text-2xl font-bold mb-1">Project managers featuring you</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mb-5">
      These project managers list you among the trades they recommend on their public Blue Seal
      profile. You can remove yourself from any of them.
    </p>

    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)] py-6 text-center">Loading…</div>
    <div v-else-if="rows.length === 0" class="bs-card p-6 text-center">
      <i class="pi pi-star text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">No one's featuring you right now</p>
      <p class="text-sm text-[color:var(--bs-muted)]">
        When a project manager adds you to their public profile, they'll show up here.
      </p>
    </div>
    <ul v-else class="grid grid-cols-1 gap-2">
      <li v-for="pm in rows" :key="pm.id" class="bs-card p-3 flex items-center gap-3">
        <i class="pi pi-briefcase text-[color:var(--bs-blue)]"></i>
        <div class="min-w-0 flex-1">
          <p class="font-medium truncate">{{ pm.pmName ?? "A project manager" }}</p>
          <p class="text-xs text-[color:var(--bs-muted)]">Features you on their public profile</p>
        </div>
        <Button
          label="Remove me"
          icon="pi pi-times"
          size="small"
          outlined
          severity="secondary"
          :loading="busy === pm.id"
          @click="optOut(pm)"
        />
      </li>
    </ul>
  </section>
</template>
