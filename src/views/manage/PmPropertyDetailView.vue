<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import { getProperty } from "@/firebase/services/properties";
import { subscribeProjectsForPm } from "@/firebase/services/projects";
import { tradeLabel } from "@/data/trades";
import NewProjectForm from "@/components/manage/NewProjectForm.vue";
import type { ProjectDoc, PropertyDoc, WithId } from "@/firebase/interfaces";

// A property's home: its address + the PROJECTS at it (each holds the trade jobs).
// This is the Property -> Projects -> Jobs hierarchy: open a property to set up and
// track its work. New projects are scoped to this property.
const route = useRoute();
const auth = useAuthStore();
useSeo({ title: "Property", noindex: true });

const propertyId = computed(() => String(route.params.propertyId ?? ""));
const property = ref<WithId<PropertyDoc> | null>(null);
const allProjects = ref<WithId<ProjectDoc>[]>([]);
const loading = ref(true);
const showForm = ref(false);
let unsub: (() => void) | null = null;

const projects = computed(() => allProjects.value.filter((p) => p.propertyId === propertyId.value));

const statusSeverity: Record<string, "info" | "warn" | "success" | "secondary"> = {
  invited: "info",
  claimed: "warn",
  accepted: "success",
  declined: "secondary",
  cancelled: "secondary",
};
const statusLabel: Record<string, string> = {
  invited: "Invite sent",
  claimed: "Client joined",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};

async function loadProperty() {
  loading.value = true;
  property.value = propertyId.value ? await getProperty(propertyId.value) : null;
  loading.value = false;
}

onMounted(() => {
  const uid = auth.fbUser?.uid;
  loadProperty();
  if (uid) unsub = subscribeProjectsForPm(uid, (p) => (allProjects.value = p));
});
watch(propertyId, loadProperty);
onUnmounted(() => unsub?.());
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <div class="text-sm text-[color:var(--bs-muted)] mb-2">
      <RouterLink to="/manage/properties" class="text-[color:var(--bs-blue)] no-underline">
        <i class="pi pi-arrow-left text-xs"></i> Properties
      </RouterLink>
    </div>

    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)] py-8 text-center">Loading…</div>
    <div v-else-if="!property" class="bs-card p-6 text-center">
      <i class="pi pi-home text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">Property not found</p>
    </div>

    <template v-else>
      <img
        v-if="property.photoUrl"
        :src="property.photoUrl"
        :alt="property.label"
        class="w-full h-40 sm:h-52 rounded-xl object-cover mb-4"
      />
      <h1 class="text-2xl font-bold">{{ property.label }}</h1>
      <p v-if="property.addressText" class="text-sm text-[color:var(--bs-muted)] mt-1">
        {{ property.addressText }}
      </p>
      <p v-if="property.notes" class="text-sm text-[color:var(--bs-muted)] mt-1">{{ property.notes }}</p>

      <div class="flex items-center justify-between mt-7 mb-2">
        <h2 class="text-lg font-bold">Projects</h2>
        <Button
          v-if="!showForm"
          label="New project here"
          icon="pi pi-plus"
          size="small"
          @click="showForm = true"
        />
      </div>
      <p class="text-sm text-[color:var(--bs-muted)] mb-3">
        A bundle of jobs for this property's client. They claim it, accept, and choose their trades.
      </p>

      <!-- Don't close on `created` — the form swaps to a success card holding the
           invite link (the parent unmounting it used to destroy that link). The
           form's own "Done" emits cancel to close. -->
      <NewProjectForm
        v-if="showForm"
        :property-id="propertyId"
        class="mb-4"
        @cancel="showForm = false"
      />

      <div v-if="projects.length === 0 && !showForm" class="bs-card p-6 text-center">
        <i class="pi pi-folder-open text-2xl text-[color:var(--bs-muted)]"></i>
        <p class="mt-2 font-medium">No projects at this property yet</p>
        <p class="text-sm text-[color:var(--bs-muted)]">
          Set up a bundle of jobs and invite the client to choose their trades.
        </p>
      </div>
      <ul v-else-if="projects.length" class="grid grid-cols-1 gap-2">
        <li v-for="p in projects" :key="p.id">
          <RouterLink
            :to="{ name: 'ProjectDetail', params: { projectId: p.id } }"
            class="bs-card p-3 flex items-start gap-3 no-underline text-inherit hover:shadow-md transition-shadow"
          >
            <img v-if="p.photoUrl" :src="p.photoUrl" alt="" class="h-10 w-10 rounded object-cover shrink-0" />
            <i v-else class="pi pi-folder-open text-[color:var(--bs-blue)] mt-1"></i>
            <div class="min-w-0 flex-1">
              <p class="font-medium truncate">{{ p.label }}</p>
              <p class="text-xs text-[color:var(--bs-muted)] truncate">
                {{ p.clientName }} ·
                <template v-if="p.unit">{{ p.unit }} · </template>
                {{ p.jobSpecs.length }} {{ p.jobSpecs.length === 1 ? "job" : "jobs" }}
                <template v-if="p.jobSpecs.length">
                  ({{ p.jobSpecs.map((j) => tradeLabel(j.trade)).join(", ") }})
                </template>
              </p>
            </div>
            <Tag :value="statusLabel[p.status] ?? p.status" :severity="statusSeverity[p.status] ?? 'info'" />
            <i class="pi pi-chevron-right text-xs text-[color:var(--bs-muted)] mt-1"></i>
          </RouterLink>
        </li>
      </ul>
    </template>
  </section>
</template>
