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
          class="bs-trade-tile group flex h-full items-center gap-3 p-3 no-underline text-inherit sm:p-4"
        >
          <!-- Trade mascot on the left (generic tradesperson fallback if no art yet) -->
          <SealCharacter
            :name="`trade-${t.key}`"
            fallback="pose-toolbelt"
            class="pointer-events-none h-16 w-auto shrink-0 drop-shadow-sm transition-transform duration-300 group-hover:scale-105 sm:h-20"
          />
          <div class="min-w-0 flex-1">
            <div class="font-semibold leading-tight text-[color:var(--bs-blue-dark)]">{{ t.label }}</div>
            <span
              class="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full bg-[color:var(--bs-blue-light)]/50 px-2.5 py-0.5 text-xs font-semibold text-[color:var(--bs-blue-dark)] transition group-hover:bg-[color:var(--bs-blue)] group-hover:text-white"
            >
              Browse <i class="pi pi-arrow-right text-[10px] transition-transform group-hover:translate-x-0.5"></i>
            </span>
          </div>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
