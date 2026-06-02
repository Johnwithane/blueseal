<script setup lang="ts">
// Presentational full-profile body for a seeded prospect. Rendered by
// TradieProfileView at /tradies/:id when the id resolves to a prospect (not a
// real tradesperson) — so prospects get the SAME profile URL + shell as real
// tradies, just flagged "Unverified" with no trust UI (no rating, reviews,
// portfolio, availability, or verified badges — a seeded listing has none of
// that, and showing anything verified-looking would misrepresent them).
import { computed } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Avatar from "primevue/avatar";
import type { ProspectDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";

const props = defineProps<{ prospect: WithId<ProspectDoc> }>();
const { money } = useFormatters();

const displayName = computed(() => props.prospect.displayName?.trim() || "");
const avatarInitial = computed(() => {
  const source = displayName.value || tradeLabel(props.prospect.trades[0] ?? "");
  return source.slice(0, 1).toUpperCase() || "?";
});
const tradesWithYears = computed(() =>
  props.prospect.trades.map((key) => ({
    key,
    label: tradeLabel(key),
    years: props.prospect.yearsExperience?.[key] ?? null,
  })),
);
</script>

<template>
  <section class="bs-container py-6">
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
          <!-- CTA wired up in Phase 3 (request -> outreach). Disabled for now. -->
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
  </section>
</template>
