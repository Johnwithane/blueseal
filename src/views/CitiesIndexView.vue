<script setup lang="ts">
// Public index of city landing pages (/cities). Prerendered for local SEO and
// links every Okanagan town page so they're crawlable from one hub.
import { RouterLink } from "vue-router";
import { CITIES } from "@/data/cities";
import { useSeo } from "@/composables/useSeo";
import { citiesIndexSeo } from "@/seo/content";

useSeo(citiesIndexSeo());
</script>

<template>
  <div class="bs-container py-8">
    <header class="max-w-2xl">
      <h1 class="text-3xl font-bold">Areas we cover</h1>
      <p class="mt-2 text-[color:var(--bs-muted)]">
        Blue Seal is built in the Okanagan. Find verified tradespeople in your town, post a job and
        compare quotes, and run the whole job in one place.
      </p>
    </header>

    <div class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <RouterLink
        v-for="c in CITIES"
        :key="c.slug"
        :to="`/cities/${c.slug}`"
        class="bs-card flex items-center justify-between p-4 text-inherit no-underline transition hover:shadow-md"
      >
        <span class="font-semibold text-[color:var(--bs-blue-dark)]">{{ c.name }}, {{ c.region }}</span>
        <i class="pi pi-arrow-right text-[color:var(--bs-blue)]" aria-hidden="true"></i>
      </RouterLink>
    </div>
  </div>
</template>
