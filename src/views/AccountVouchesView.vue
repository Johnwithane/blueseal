<script setup lang="ts">
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import VouchesPanel from "@/components/VouchesPanel.vue";
</script>

<template>
  <section class="bs-container max-w-2xl py-6">
    <div class="mb-6 flex items-center justify-between gap-2">
      <div>
        <h1 class="text-2xl font-bold">Recommendations</h1>
        <p class="text-sm text-[color:var(--bs-muted)]">
          Endorse tradespeople you've worked with. Once accepted, the
          recommendation appears on both your profile and theirs.
        </p>
      </div>
      <RouterLink :to="{ name: 'Account', query: { tab: 'tradesperson' } }">
        <Button label="Back" icon="pi pi-arrow-left" text size="small" />
      </RouterLink>
    </div>

    <VouchesPanel />
  </section>
</template>
