<script setup lang="ts">
import { ref, watch } from "vue";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import { searchRosterCandidates, type RosterCard } from "@/firebase/services/rosterDirectory";
import { tradeLabel } from "@/data/trades";
import { humanizeError } from "@/utils/errors";
import InitialsAvatar from "@/components/InitialsAvatar.vue";

// "Already on Blue Seal?" — the in-cockpit way a project manager adds a
// tradesperson to their roster without leaving the page. Type a name, the
// server searches every tradesperson account by substring (verified,
// onboarding, or role-only — not just publicly-listed tradies), tap Add.
// rosterIds (the parent's live saved set) tells us who's already on the roster
// so the row shows an "On your roster" badge instead of a duplicate Add. The
// callable already excludes the caller, so no self-filtering here.
const props = defineProps<{ rosterIds: Set<string> }>();
const emit = defineEmits<{ add: [tradie: RosterCard] }>();

const query = ref("");
const results = ref<RosterCard[]>([]);
const searching = ref(false);
const error = ref<string | null>(null);

// Debounced — a Firestore fetch per keystroke would be wasteful and racey.
let timer: number | null = null;
watch(query, (v) => {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
  error.value = null;
  const q = v.trim();
  if (!q) {
    results.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  timer = window.setTimeout(async () => {
    try {
      results.value = await searchRosterCandidates(q);
    } catch (e) {
      error.value = humanizeError(e);
    } finally {
      searching.value = false;
    }
  }, 250);
});

function tradesText(t: RosterCard): string {
  if (t.profileState === "no_profile") return "Hasn't set up their profile yet";
  const ts = (t.trades ?? []).map((k) => tradeLabel(k));
  if (!ts.length) return "Tradesperson";
  return ts.slice(0, 2).join(" · ") + (ts.length > 2 ? ` +${ts.length - 2}` : "");
}
</script>

<template>
  <div class="bs-card p-4 border border-[color:var(--bs-blue)]">
    <div class="flex items-start gap-3">
      <span class="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-[color:var(--bs-blue)] text-white">
        <i class="pi pi-search"></i>
      </span>
      <div class="min-w-0">
        <p class="font-semibold">Already on Blue Seal?</p>
        <p class="text-sm text-[color:var(--bs-muted)] mt-0.5">
          Search by name and add them to your roster in one tap.
        </p>
      </div>
    </div>

    <div class="relative mt-3">
      <i class="pi pi-search pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--bs-muted)]"></i>
      <InputText
        v-model="query"
        class="w-full !pl-11"
        placeholder="Search tradespeople by name…"
        maxlength="80"
      />
    </div>

    <div v-if="error" class="mt-3 text-sm text-[color:var(--bs-danger)]">{{ error }}</div>

    <div v-else-if="searching" class="mt-4 text-center text-sm text-[color:var(--bs-muted)]">
      <i class="pi pi-spin pi-spinner mr-1"></i> Searching…
    </div>

    <ul v-else-if="results.length" class="mt-3 space-y-2">
      <li
        v-for="t in results"
        :key="t.uid"
        class="flex items-center gap-3 rounded-lg border border-[color:var(--bs-border)] p-2"
      >
        <InitialsAvatar :name="t.displayName" :photo-url="t.photoURL" :size="36" tone="solid" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-sm truncate">{{ t.displayName || "Tradesperson" }}</p>
          <p class="text-xs text-[color:var(--bs-muted)] truncate">{{ tradesText(t) }}</p>
          <p
            v-if="t.profileState !== 'live'"
            class="text-[11px] text-[color:var(--bs-warning-text)] truncate mt-0.5"
          >
            <i class="pi pi-clock text-[9px] mr-1"></i>Not verified yet
          </p>
        </div>
        <span
          v-if="props.rosterIds.has(t.uid)"
          class="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--bs-success-text)] bg-[color:var(--bs-success-tint)] rounded-md px-2.5 py-1.5"
        >
          <i class="pi pi-check"></i> On your roster
        </span>
        <Button v-else label="Add to roster" icon="pi pi-plus" size="small" @click="emit('add', t)" />
      </li>
    </ul>

    <div
      v-else-if="query.trim()"
      class="mt-4 rounded-lg border border-dashed border-[color:var(--bs-border)] p-3 text-sm text-[color:var(--bs-muted)]"
    >
      No one on Blue Seal matches "<strong class="text-[color:var(--bs-text)]">{{ query.trim() }}</strong>". They
      might not be on Blue Seal yet. Use your invite link below.
    </div>

    <p v-else class="mt-3 text-xs text-[color:var(--bs-muted)]">
      Tip: start typing a name to see matches from the Blue Seal directory.
    </p>
  </div>
</template>
