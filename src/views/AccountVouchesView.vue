<script setup lang="ts">
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import VouchesPanel from "@/components/VouchesPanel.vue";
</script>

<template>
  <section class="bs-container max-w-2xl py-6">
    <div class="mb-6 flex items-center justify-end gap-2">
      <RouterLink :to="{ name: 'Account', query: { tab: 'tradesperson' } }">
        <Button label="Back" icon="pi pi-arrow-left" text size="small" />
      </RouterLink>
    </div>

    <VouchesPanel />
  </section>
</template>
