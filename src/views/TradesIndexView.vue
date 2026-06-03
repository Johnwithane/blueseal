<script setup lang="ts">
// Public "all trades" index — an SEO + discovery hub linking to every per-trade
// landing page (/trades/:trade). Prerendered (scripts/prerender.ts) so crawlers
// and LLMs get the full trade list as real HTML.
import { RouterLink } from "vue-router";
import { TRADES } from "@/data/trades";
import SealCharacter from "@/components/SealCharacter.vue";
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

    <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      <li v-for="t in TRADES" :key="t.key">
        <RouterLink
          :to="`/trades/${t.key}`"
          class="bs-trade-tile group flex h-full flex-col items-center p-5 text-center no-underline text-inherit"
        >
          <!-- Trade mascot is the hero (generic tradesperson fallback if no art yet) -->
          <SealCharacter
            :name="`trade-${t.key}`"
            fallback="pose-toolbelt"
            class="pointer-events-none h-28 w-auto drop-shadow-md transition-transform duration-300 group-hover:scale-105 sm:h-32"
          />
          <div class="mt-3 font-semibold text-[color:var(--bs-blue-dark)]">{{ t.label }}</div>
          <span
            class="mt-2 inline-flex items-center gap-1 rounded-full bg-[color:var(--bs-blue-light)]/50 px-3 py-1 text-xs font-semibold text-[color:var(--bs-blue-dark)] transition group-hover:bg-[color:var(--bs-blue)] group-hover:text-white"
          >
            Browse <i class="pi pi-arrow-right text-[10px]"></i>
          </span>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
