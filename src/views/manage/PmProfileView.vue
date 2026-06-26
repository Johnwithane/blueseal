<script setup lang="ts">
import { useSeo } from "@/composables/useSeo";
import PmProfilePanel from "@/components/manage/PmProfilePanel.vue";

useSeo({ title: "Public profile", noindex: true });
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <h1 class="text-2xl font-bold mb-1">Public profile</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mb-5">
      Your own shareable page at a /pm/ link. Publish it to introduce yourself and the trades you
      recommend.
    </p>
    <PmProfilePanel />
  </section>
</template>
