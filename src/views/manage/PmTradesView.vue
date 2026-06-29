<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import {
  subscribeSavedTradieIds,
  hydrateSavedTradies,
  saveTradie,
  unsaveTradie,
} from "@/firebase/services/savedTradies";
import { tradeLabel } from "@/data/trades";
import PmRosterSearch from "@/components/manage/PmRosterSearch.vue";
import PmEmailInviteForm from "@/components/manage/PmEmailInviteForm.vue";
import PmInviteLinkCard from "@/components/manage/PmInviteLinkCard.vue";
import InitialsAvatar from "@/components/InitialsAvatar.vue";
import type { TradespersonDoc, WeeklyAvailability, WithId } from "@/firebase/interfaces";

// The PM's roster: the tradespeople they work with. Two clear ways to grow it —
// add someone already on Blue Seal (in-cockpit search), or invite someone who
// isn't on Blue Seal yet via the personal /join?pm= link. Backed by the existing
// savedTradies shortlist; dispatch sends each project job to the matching roster.
useSeo({ title: "Roster", noindex: true });

const auth = useAuthStore();
const toast = useToast();

const loading = ref(true);
const rosterIds = ref<Set<string>>(new Set());
const roster = ref<WithId<TradespersonDoc>[]>([]);
let unsub: (() => void) | null = null;

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) {
    loading.value = false;
    return;
  }
  unsub = subscribeSavedTradieIds(uid, async (ids) => {
    rosterIds.value = ids;
    roster.value = await hydrateSavedTradies([...ids]);
    loading.value = false;
  });
});
onUnmounted(() => unsub?.());

async function add(t: WithId<TradespersonDoc>): Promise<void> {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  try {
    await saveTradie(uid, t.id);
    toast.success("Added to your roster", "Your matching project jobs will now go to them for a quote.");
  } catch (e) {
    toast.error(humanizeError(e));
  }
}

async function remove(t: WithId<TradespersonDoc>): Promise<void> {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  try {
    await unsaveTradie(uid, t.id);
  } catch (e) {
    toast.error(humanizeError(e));
  }
}

function tradesText(t: WithId<TradespersonDoc>): string {
  const ts = (t.trades ?? []).map((k) => tradeLabel(k));
  if (!ts.length) return "Tradesperson";
  return ts.slice(0, 2).join(" · ") + (ts.length > 2 ? ` +${ts.length - 2}` : "");
}

// Which weekdays the contractor lists as available (mon→sun), for the roster
// at-a-glance. Empty when they haven't set any availability.
const DAY_LABELS: Array<[keyof WeeklyAvailability, string]> = [
  ["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"],
  ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"],
];
function availableDays(t: WithId<TradespersonDoc>): string[] {
  const a = t.weeklyAvailability;
  if (!a) return [];
  return DAY_LABELS.filter(([k]) => (a[k]?.length ?? 0) > 0).map(([, l]) => l);
}
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <RouterLink to="/manage" class="text-xs text-[color:var(--bs-muted)]">
      <i class="pi pi-arrow-left text-xs"></i> Cockpit
    </RouterLink>

    <h1 class="text-2xl font-bold mt-2 mb-1">Your roster</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mb-6 max-w-prose">
      The tradespeople you work with. When you set up a project, each job goes to the matching people
      on your roster for a quote.
    </p>

    <div class="flex items-center gap-3 mb-3">
      <span class="h-px flex-1 bg-[color:var(--bs-border)]"></span>
      <span class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)]">
        Add to your roster
      </span>
      <span class="h-px flex-1 bg-[color:var(--bs-border)]"></span>
    </div>

    <div class="space-y-3">
      <PmRosterSearch :roster-ids="rosterIds" @add="add" />
      <PmEmailInviteForm />
      <PmInviteLinkCard />
    </div>

    <div class="flex items-center justify-between mt-8 mb-3">
      <h2 class="font-semibold flex items-center gap-2">
        <i class="pi pi-users text-[color:var(--bs-blue)]"></i> On your roster
      </h2>
      <span v-if="roster.length" class="text-xs font-semibold text-[color:var(--bs-muted)]">
        {{ roster.length }} {{ roster.length === 1 ? "person" : "people" }}
      </span>
    </div>

    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)] py-6 text-center">Loading…</div>
    <div v-else-if="roster.length === 0" class="bs-card p-6 text-center">
      <i class="pi pi-users text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">No one on your roster yet</p>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Add tradespeople above. They're who your projects go to for quotes.
      </p>
    </div>
    <ul v-else class="grid grid-cols-1 gap-2">
      <li v-for="t in roster" :key="t.id" class="bs-card p-3 flex items-center gap-3">
        <InitialsAvatar :name="t.displayName" :photo-url="t.photoURL" :size="40" tone="solid" />
        <div class="min-w-0 flex-1">
          <p class="font-medium truncate">{{ t.displayName ?? "Tradesperson" }}</p>
          <p class="text-xs text-[color:var(--bs-muted)] truncate">{{ tradesText(t) }}</p>
          <p
            v-if="availableDays(t).length"
            class="text-[11px] text-[color:var(--bs-muted)] truncate mt-0.5"
          >
            <i class="pi pi-calendar text-[9px] mr-1"></i>Available {{ availableDays(t).join(", ") }}
          </p>
        </div>
        <RouterLink :to="{ name: 'RequestQuote', params: { uid: t.id } }">
          <Button label="Request" icon="pi pi-send" size="small" outlined />
        </RouterLink>
        <Button
          icon="pi pi-times"
          text
          rounded
          severity="secondary"
          aria-label="Remove from roster"
          @click="remove(t)"
        />
      </li>
    </ul>
  </section>
</template>
