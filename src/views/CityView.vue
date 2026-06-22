<script setup lang="ts">
// Public per-city landing page (/cities/:city) — e.g. "Verified tradespeople in
// Kelowna, BC". Prerendered (scripts/prerender.ts) with City Service +
// breadcrumb JSON-LD so it's discoverable locally. Content is static (no
// Firebase) so it stays prerender-safe; the CTAs route into live search / post.
import { computed } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import { CITIES, findCity } from "@/data/cities";
import { TRADES } from "@/data/trades";
import SealCharacter from "@/components/SealCharacter.vue";
import { useSeo } from "@/composables/useSeo";
import { citySeo, TRUST_POINTS, HOW_IT_WORKS } from "@/seo/content";

const route = useRoute();
const router = useRouter();
const slug = computed(() => String(route.params.city ?? ""));
const city = computed(() => findCity(slug.value));
const otherCities = computed(() => CITIES.filter((c) => c.slug !== slug.value));
const topTrades = TRADES.slice(0, 12);

useSeo(() => citySeo(slug.value) ?? { title: "Area not found", noindex: true });

// Centre the search on this city, then hand off to live search (SearchView
// hydrates its `location` from this same localStorage key on mount).
function findInCity() {
  const c = city.value;
  if (!c) return;
  try {
    localStorage.setItem(
      "searchLocation",
      JSON.stringify({ lat: c.lat, lng: c.lng, radiusKm: 50, label: `${c.name}, ${c.region}` }),
    );
  } catch {
    /* storage unavailable — /search still loads, just without the prefilled area */
  }
  router.push("/search");
}
</script>

<template>
  <div class="bs-container py-8">
    <div v-if="!city" class="bs-empty py-20 text-center">
      <i class="pi pi-map-marker text-4xl text-[color:var(--bs-blue)]"></i>
      <h1 class="mt-3 text-2xl font-bold">Area not found</h1>
      <p class="mt-1 text-[color:var(--bs-muted)]">We don't have a page for that area yet.</p>
      <RouterLink to="/cities" class="mt-6 inline-block">
        <Button label="See all areas" icon="pi pi-map" />
      </RouterLink>
    </div>

    <template v-else>
      <nav class="mb-4 text-sm text-[color:var(--bs-muted)]">
        <RouterLink to="/cities" class="hover:underline">Areas</RouterLink>
        <span class="mx-1">›</span>
        <span>{{ city.name }}</span>
      </nav>

      <div class="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <header class="max-w-2xl">
          <h1 class="text-3xl font-bold">Verified tradespeople in {{ city.name }}, {{ city.region }}</h1>
          <p class="mt-2 text-[color:var(--bs-muted)]">{{ city.intro }}</p>
          <div class="mt-5 flex flex-wrap gap-3">
            <Button :label="`Find a pro in ${city.name}`" icon="pi pi-search" @click="findInCity" />
            <RouterLink to="/jobs/post">
              <Button label="Post a job, get quotes" icon="pi pi-send" severity="secondary" outlined />
            </RouterLink>
          </div>
        </header>
        <SealCharacter
          name="pose-toolbelt"
          eager
          class="mx-auto h-48 w-auto shrink-0 drop-shadow-xl sm:mx-0 sm:h-56 lg:h-64"
        />
      </div>

      <div class="mt-10 grid gap-8 md:grid-cols-2">
        <section>
          <h2 class="text-xl font-semibold">Every {{ city.name }} pro, verified</h2>
          <ul class="mt-3 space-y-2">
            <li v-for="point in TRUST_POINTS" :key="point" class="flex items-start gap-2 text-sm">
              <i class="pi pi-check-circle mt-0.5 text-[color:var(--bs-blue)]" aria-hidden="true"></i>
              <span>{{ point }}</span>
            </li>
          </ul>
        </section>

        <section>
          <h2 class="text-xl font-semibold">How Blue Seal works in {{ city.name }}</h2>
          <ol class="mt-3 space-y-2">
            <li v-for="(step, i) in HOW_IT_WORKS" :key="i" class="flex items-start gap-2 text-sm">
              <span
                class="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[color:var(--bs-blue)] text-xs font-bold text-white"
                >{{ i + 1 }}</span
              >
              <span>{{ step }}</span>
            </li>
          </ol>
        </section>
      </div>

      <section class="mt-10">
        <h2 class="text-xl font-semibold">Popular trades in {{ city.name }}</h2>
        <div class="mt-3 flex flex-wrap gap-2">
          <RouterLink
            v-for="t in topTrades"
            :key="t.key"
            :to="`/search?trade=${t.key}`"
            class="rounded-full bg-[color:var(--bs-light-blue)]/40 px-3 py-1 text-sm text-[color:var(--bs-blue-dark)] transition hover:bg-[color:var(--bs-light-blue)]"
            >{{ t.label }}</RouterLink
          >
        </div>
        <RouterLink
          to="/trades"
          class="mt-3 inline-block text-sm text-[color:var(--bs-blue)] hover:underline"
        >See all trades</RouterLink>
      </section>

      <section class="mt-10">
        <h2 class="text-xl font-semibold">Other areas we cover</h2>
        <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <RouterLink
            v-for="c in otherCities"
            :key="c.slug"
            :to="`/cities/${c.slug}`"
            class="text-[color:var(--bs-blue)] hover:underline"
            >{{ c.name }}</RouterLink
          >
        </div>
      </section>
    </template>
  </div>
</template>
