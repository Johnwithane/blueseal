<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import Button from "primevue/button";
import { useSeo } from "@/composables/useSeo";
import PropertiesPanel from "@/components/PropertiesPanel.vue";
import NewProjectForm from "@/components/manage/NewProjectForm.vue";

// The property book. Each property is the home for its projects (and their jobs):
// open one to set up and track its work. The Property -> Projects -> Jobs hierarchy
// lives in PmPropertyDetailView. A project can also be created here WITHOUT a
// property (property optional) — so a brand-new PM with no properties yet isn't
// blocked. The dashboard "New project" action deep-links here with ?new=1.
useSeo({ title: "Properties", noindex: true });

const route = useRoute();
const showForm = ref(false);
onMounted(() => {
  if (route.query.new != null) showForm.value = true;
});
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <div class="flex items-start justify-between gap-3 mb-1">
      <h1 class="text-2xl font-bold">Properties</h1>
      <Button
        v-if="!showForm"
        label="New project"
        icon="pi pi-plus"
        size="small"
        @click="showForm = true"
      />
    </div>
    <p class="text-sm text-[color:var(--bs-muted)] mb-4">
      The addresses you manage. Open a property to set up <strong>projects</strong> for its client,
      each holding the individual trade <strong>jobs</strong>.
    </p>

    <!-- Property-less project entry (property optional inside the form). The form
         swaps to a success card with the client's invite link, then "Done" closes it. -->
    <div v-if="showForm" class="mb-5">
      <h2 class="text-lg font-bold mb-2">New project</h2>
      <p class="text-sm text-[color:var(--bs-muted)] mb-3">
        Set up a bundle of jobs and invite the client by email. You can attach it to one of your
        properties or leave it unattached.
      </p>
      <NewProjectForm @cancel="showForm = false" />
    </div>

    <PropertiesPanel />
  </section>
</template>
