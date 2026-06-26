<script setup lang="ts">
import { useSeo } from "@/composables/useSeo";
import PropertiesPanel from "@/components/PropertiesPanel.vue";
import ProjectsPanel from "@/components/ProjectsPanel.vue";

// Interim layout: properties + projects on one page. The Property -> Projects -> Jobs
// drill-down (open a property to see and create its projects) is the next increment;
// today this gives both a home under the new nav.
useSeo({ title: "Properties", noindex: true });
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <h1 class="text-2xl font-bold mb-1">Properties</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mb-3">
      The addresses you manage. Each property holds your projects, and each project holds the
      individual trade jobs.
    </p>
    <PropertiesPanel />

    <h2 class="text-lg font-bold mt-8 mb-1">Projects</h2>
    <p class="text-sm text-[color:var(--bs-muted)] mb-3">
      A bundle of jobs you set up for a client. Tap one to see incoming quotes and job status.
    </p>
    <ProjectsPanel />
  </section>
</template>
