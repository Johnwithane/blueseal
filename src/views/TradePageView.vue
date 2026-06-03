<script setup lang="ts">
// Public per-trade landing page (/trades/:trade) — e.g. "Hire a verified
// Plumber in Canada". Prerendered (scripts/prerender.ts) with Service + breadcrumb
// JSON-LD so it's discoverable by search engines and LLMs. Content is static
// (no Firebase) so it stays prerender-safe; the CTA routes into live search.
import { computed } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Button from "primevue/button";
import { TRADES } from "@/data/trades";
import { useSeo } from "@/composables/useSeo";
import { tradePageSeo, TRUST_POINTS, HOW_IT_WORKS } from "@/seo/content";

const route = useRoute();
const tradeKey = computed(() => String(route.params.trade ?? ""));
const trade = computed(() => TRADES.find((t) => t.key === tradeKey.value) ?? null);
const label = computed(() => (trade.value ? trade.value.label : ""));

useSeo(() => tradePageSeo(tradeKey.value) ?? { title: "Trade not found", noindex: true });
</script>

<template>
  <div class="bs-container py-8">
    <div v-if="!trade" class="bs-empty py-20 text-center">
      <i class="pi pi-compass text-4xl text-[color:var(--bs-blue)]"></i>
      <h1 class="mt-3 text-2xl font-bold">Trade not found</h1>
      <p class="mt-1 text-[color:var(--bs-muted)]">That trade doesn't exist on Blue Seal.</p>
      <RouterLink to="/trades" class="mt-6 inline-block">
        <Button label="Browse all trades" icon="pi pi-th-large" />
      </RouterLink>
    </div>

    <template v-else>
      <nav class="mb-4 text-sm text-[color:var(--bs-muted)]">
        <RouterLink to="/trades" class="hover:underline">Trades</RouterLink>
        <span class="mx-1">›</span>
        <span>{{ label }}</span>
      </nav>

      <header class="max-w-2xl">
        <h1 class="text-3xl font-bold">Hire a verified {{ label }} in Canada</h1>
        <p class="mt-2 text-[color:var(--bs-muted)]">
          Find a verified, ID-checked {{ label.toLowerCase() }} on Blue Seal. Compare certified
          pros across Canada, request quotes, schedule and pay — all in one trusted job thread,
          with mutual reviews after every job.
        </p>
        <div class="mt-5 flex flex-wrap gap-3">
          <RouterLink :to="`/search?trade=${trade.key}`">
            <Button :label="`Find a ${label} near you`" icon="pi pi-search" />
          </RouterLink>
          <RouterLink to="/jobs/post">
            <Button label="Post a job, get quotes" icon="pi pi-send" severity="secondary" outlined />
          </RouterLink>
        </div>
      </header>

      <div class="mt-10 grid gap-8 md:grid-cols-2">
        <section>
          <h2 class="text-xl font-semibold">Why hire a {{ label.toLowerCase() }} through Blue Seal</h2>
          <ul class="mt-3 space-y-2">
            <li v-for="point in TRUST_POINTS" :key="point" class="flex items-start gap-2 text-sm">
              <i class="pi pi-check-circle mt-0.5 text-[color:var(--bs-blue)]" aria-hidden="true"></i>
              <span>{{ point }}</span>
            </li>
          </ul>
        </section>

        <section>
          <h2 class="text-xl font-semibold">How it works</h2>
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

      <p class="mt-10 text-sm text-[color:var(--bs-muted)]">
        Looking for something else?
        <RouterLink to="/trades" class="text-[color:var(--bs-blue)] hover:underline">
          Browse all trades
        </RouterLink>
        or
        <RouterLink to="/search" class="text-[color:var(--bs-blue)] hover:underline">
          search every verified pro
        </RouterLink>.
      </p>
    </template>
  </div>
</template>
