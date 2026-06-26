<script setup lang="ts">
import { useSeo } from "@/composables/useSeo";
import PropertiesPanel from "@/components/PropertiesPanel.vue";

// The property book. Each property is the home for its projects (and their jobs):
// open one to set up and track its work. The Property -> Projects -> Jobs hierarchy
// lives in PmPropertyDetailView.
useSeo({ title: "Properties", noindex: true });
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <h1 class="text-2xl font-bold mb-1">Properties</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mb-4">
      The addresses you manage. Open a property to set up <strong>projects</strong> for its client,
      each holding the individual trade <strong>jobs</strong>.
    </p>
    <PropertiesPanel />
  </section>
</template>
