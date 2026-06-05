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

    <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <li v-for="t in TRADES" :key="t.key">
        <RouterLink
          :to="`/trades/${t.key}`"
          class="bs-trade-tile group flex h-full items-center gap-4 p-4 no-underline text-inherit"
        >
          <!-- Trade mascot, zoomed in & cropped at the waist (fills the card, more dynamic) -->
          <div class="pointer-events-none relative h-24 shrink-0 overflow-hidden sm:h-28">
            <SealCharacter
              :name="`trade-${t.key}`"
              fallback="pose-toolbelt"
              class="block h-40 w-auto max-w-none origin-top transition-transform duration-300 group-hover:scale-105 sm:h-48"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-lg font-bold leading-tight text-[color:var(--bs-blue-dark)] sm:text-xl">
              {{ t.label }}
            </div>
            <span
              class="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-[color:var(--bs-blue-light)]/50 px-3.5 py-1.5 text-sm font-semibold text-[color:var(--bs-blue-dark)] transition group-hover:bg-[color:var(--bs-blue)] group-hover:text-white"
            >
              Browse <i class="pi pi-arrow-right text-xs transition-transform group-hover:translate-x-0.5"></i>
            </span>
          </div>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
