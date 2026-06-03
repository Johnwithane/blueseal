<script setup lang="ts">
import Button from "primevue/button";
import SealCharacter from "@/components/SealCharacter.vue";
import { useSeo } from "@/composables/useSeo";

useSeo({ title: "Page not found", noindex: true });
</script>

<template>
  <section class="bs-container py-24 text-center">
    <SealCharacter name="pose-question" eager fallback="pose-shrug" class="mx-auto h-48 w-auto sm:h-56" />
    <h1 class="text-3xl font-bold mt-3">Page not found</h1>
    <p class="text-[color:var(--bs-muted)] mt-2">That route doesn't exist.</p>
    <router-link to="/" class="inline-block mt-6">
      <Button label="Back home" icon="pi pi-home" />
    </router-link>
  </section>
</template>
