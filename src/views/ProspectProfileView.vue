<script setup lang="ts">
// Public profile for a seeded prospect — the TradieProfileView layout stripped
// down to what a seeded, unclaimed, unvetted listing legitimately shows: name,
// trades, coarse coverage, bio, pricing. NO trust badges, rating, portfolio,
// availability, reviews, or recommendations — those don't exist on a prospect
// and showing anything verified-looking would misrepresent them. A banner makes
// the "from public records, not yet verified" status explicit. The "Request
// this pro" CTA is present but disabled until Phase 3 wires up outreach.
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Avatar from "primevue/avatar";
import { getProspect } from "@/firebase/services/prospects";
import type { ProspectDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";

const route = useRoute();
const prospect = ref<WithId<ProspectDoc> | null>(null);
const loading = ref(true);
const { money } = useFormatters();

const displayName = computed(() => prospect.value?.displayName?.trim() || "");
const avatarInitial = computed(() => {
  const source = displayName.value || tradeLabel(prospect.value?.trades[0] ?? "");
  return source.slice(0, 1).toUpperCase() || "?";
});

const tradesWithYears = computed(() => {
  const p = prospect.value;
  if (!p) return [];
  return p.trades.map((key) => ({
    key,
    label: tradeLabel(key),
    years: p.yearsExperience?.[key] ?? null,
  }));
});

onMounted(async () => {
  prospect.value = await getProspect(route.params.id as string);
  loading.value = false;
});
</script>

<template>
  <section class="bs-container py-6">
    <div v-if="loading" class="bs-empty">Loading…</div>
    <div v-else-if="!prospect" class="bs-empty">
      <i class="pi pi-times-circle text-3xl mb-2 block"></i>
      <p>Profile not found.</p>
    </div>
    <template v-else>
      <!-- Status banner. Always shown — this profile isn't verified yet. -->
      <div
        class="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3"
      >
        <i class="pi pi-info-circle text-lg mt-0.5 text-amber-700" aria-hidden="true"></i>
        <div class="text-sm">
          <div class="font-semibold text-amber-900">Unverified</div>
          <p class="text-amber-900/80">
            This tradesperson hasn't been verified by Blue Seal yet.
          </p>
        </div>
      </div>

      <header class="bs-card p-5">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar
            v-if="prospect.photoURL"
            :image="prospect.photoURL"
            size="xlarge"
            shape="circle"
          />
          <Avatar
            v-else
            :label="avatarInitial"
            size="xlarge"
            shape="circle"
            style="background-color: var(--bs-muted); color: white; font-weight: 700;"
          />
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-2xl font-bold">
                {{ displayName || tradeLabel(prospect.trades[0]) }}
              </h1>
              <Tag value="Unverified" severity="warn" />
            </div>
            <div v-if="prospect.companyName" class="text-sm text-[color:var(--bs-muted)]">
              {{ prospect.companyName }}
            </div>
            <div class="mt-1 text-sm text-[color:var(--bs-muted)]">
              {{ tradesWithYears.map((t) => t.label).join(" · ") }}
            </div>
            <div class="mt-1 text-sm text-[color:var(--bs-muted)]">
              <span v-if="prospect.locationLabel">
                <i class="pi pi-map-marker text-xs"></i> {{ prospect.locationLabel }}
              </span>
              <span v-if="prospect.serviceRadiusKm">
                • {{ prospect.serviceRadiusKm }} km radius</span>
            </div>
            <div v-if="tradesWithYears.length" class="mt-2 flex flex-wrap items-center gap-1">
              <span v-for="t in tradesWithYears" :key="t.key" class="bs-pill">
                {{ t.label }}
                <span v-if="t.years" class="opacity-75">· {{ t.years }}y</span>
              </span>
            </div>
            <div
              v-if="prospect.languages && prospect.languages.length"
              class="mt-2 text-xs text-[color:var(--bs-muted)]"
            >
              <i class="pi pi-comments mr-1"></i>
              Speaks {{ prospect.languages.join(", ") }}
            </div>
          </div>
          <div class="flex flex-col items-stretch gap-1">
            <!-- CTA wired up in Phase 3 (request → outreach). Disabled for now
                 so the surface ships without sending anything. -->
            <Button label="Request this pro" icon="pi pi-send" disabled />
            <span class="text-center text-xs text-[color:var(--bs-muted)]">
              Available soon
            </span>
          </div>
        </div>
      </header>

      <section v-if="prospect.bio || prospect.hourlyRate != null" class="bs-card p-5 mt-4 space-y-3">
        <h2 class="font-semibold">About</h2>
        <p v-if="prospect.bio" class="text-sm whitespace-pre-wrap">{{ prospect.bio }}</p>
        <div class="text-sm text-[color:var(--bs-muted)]">
          Pricing:
          <strong class="text-[color:var(--bs-text)]">
            {{ prospect.hourlyRate ? money(prospect.hourlyRate) + "/hr" : "Quote on request" }}
          </strong>
        </div>
      </section>
    </template>
  </section>
</template>
