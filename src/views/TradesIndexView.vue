<script setup lang="ts">
// Public "all trades" index — an SEO + discovery hub linking to every per-trade
// landing page (/trades/:trade). Prerendered (scripts/prerender.ts) so crawlers
// and LLMs get the full trade list as real HTML.
import { RouterLink } from "vue-router";
import { TRADES } from "@/data/trades";
import { useSeo } from "@/composables/useSeo";
import { tradesIndexSeo } from "@/seo/content";

useSeo(tradesIndexSeo());
</script>

<template>
  <div class="bs-container py-8">
    <header class="mb-6 max-w-2xl">
      <h1 class="text-3xl font-bold">Find a verified tradesperson by trade</h1>
      <p class="mt-2 text-[color:var(--bs-muted)]">
        Every trade on Blue Seal is staffed by manually verified pros — government ID, trade
        certification, insurance and WSIB checked. Pick a trade to find one near you across Canada.
      </p>
    </header>

    <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <li v-for="t in TRADES" :key="t.key">
        <RouterLink
          :to="`/trades/${t.key}`"
          class="flex items-center gap-3 rounded-lg border border-[color:var(--bs-border)] bg-white p-3 hover:border-[color:var(--bs-blue)] hover:shadow-sm transition"
        >
          <i :class="t.icon" class="text-xl text-[color:var(--bs-blue)]" aria-hidden="true"></i>
          <span class="text-sm font-medium">{{ t.label }}</span>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
