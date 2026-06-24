<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Message from "primevue/message";
import type { RegionDoc, WithId } from "@/firebase/interfaces";
import { deleteRegion, listRegions } from "@/firebase/services/regions";
import { findDuplicatePrefixes } from "@/utils/regionMatch";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import LoadingState from "@/components/LoadingState.vue";
import AdminRegionForm from "@/components/admin/AdminRegionForm.vue";

// Admin CRUD for sales territories. Each region maps postal FSA prefixes to the
// rep who owns it (and earns commission on it). Self-contained (no Pinia),
// mirrors AdminRebateProgramsView.
const toast = useToast();

const regions = ref<WithId<RegionDoc>[]>([]);
const loading = ref(true);
const editing = ref<WithId<RegionDoc> | null>(null);
const adding = ref(false);
const confirmingDelete = ref<string | null>(null);

// Prefixes claimed by 2+ regions would mis-route commission — warn the admin.
const duplicatePrefixes = computed(() => findDuplicatePrefixes(regions.value));

onMounted(load);

async function load() {
  loading.value = true;
  try {
    regions.value = await listRegions();
  } catch (e) {
    toast.error("Couldn't load", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

function startAdd() {
  editing.value = null;
  adding.value = true;
}

function startEdit(r: WithId<RegionDoc>) {
  adding.value = false;
  editing.value = r;
}

function closeForm() {
  adding.value = false;
  editing.value = null;
}

async function onSaved() {
  closeForm();
  await load();
}

async function confirmDelete(id: string) {
  try {
    await deleteRegion(id);
    toast.success("Deleted", "Region removed.");
    confirmingDelete.value = null;
    await load();
  } catch (e) {
    toast.error("Couldn't delete", humanizeError(e));
  }
}
</script>

<template>
  <section class="bs-container py-8 max-w-4xl">
    <RouterLink to="/dashboard/admin" class="text-xs text-[color:var(--bs-muted)]">
      ← Admin console
    </RouterLink>

    <header class="mt-2 mb-5">
      <h1 class="text-lg font-semibold">Sales regions</h1>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        Territories for regional sales reps. Each region is a set of postal (FSA) prefixes; a
        tradesperson is auto-assigned to a region by their address. The assigned rep vets that
        region's applications and earns the residual commission on it.
      </p>
    </header>

    <Message v-if="duplicatePrefixes.length" severity="warn" :closable="false" class="mb-4">
      These postal prefixes are claimed by more than one region:
      <strong>{{ duplicatePrefixes.join(", ") }}</strong>. A tradesperson there would route to
      whichever region has the most specific prefix — give each prefix to a single region.
    </Message>

    <div class="flex flex-wrap gap-2 mb-4">
      <Button label="Add region" icon="pi pi-plus" :disabled="adding" @click="startAdd" />
    </div>

    <AdminRegionForm v-if="adding" :region="null" class="mb-4" @saved="onSaved" @cancel="closeForm" />

    <LoadingState v-if="loading" />

    <div v-else-if="!regions.length && !adding" class="text-sm text-[color:var(--bs-muted)]">
      No regions yet. Add your first territory to start onboarding a regional rep.
    </div>

    <div v-else class="space-y-4">
      <div v-for="r in regions" :key="r.id">
        <AdminRegionForm
          v-if="editing && editing.id === r.id"
          :region="r"
          @saved="onSaved"
          @cancel="closeForm"
        />
        <div v-else class="bs-card p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="text-sm font-semibold truncate">{{ r.name }}</h2>
                <span
                  class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                  :style="
                    r.status === 'active'
                      ? 'background-color: var(--bs-surface-alt); color: var(--bs-blue)'
                      : 'background-color: var(--bs-surface-alt); color: var(--bs-muted)'
                  "
                >
                  {{ r.status }}
                </span>
              </div>
              <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
                {{ r.province }} · {{ r.fsaPrefixes.join(", ") }}
              </p>
              <p class="text-xs text-[color:var(--bs-muted)] mt-1">
                Rep: <span :class="r.repId ? '' : 'italic'">{{ r.repId || "unassigned" }}</span>
                · {{ r.activeTradieCount }} active / {{ r.totalTradieCount }} total
                · unlocks at {{ r.marketing.thresholdActive }}
              </p>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <template v-if="confirmingDelete === r.id">
                <span class="text-xs text-[color:var(--bs-muted)] mr-1">Delete?</span>
                <Button label="Cancel" text size="small" @click="confirmingDelete = null" />
                <Button label="Delete" severity="danger" size="small" @click="confirmDelete(r.id)" />
              </template>
              <template v-else>
                <Button icon="pi pi-pencil" text size="small" label="Edit" @click="startEdit(r)" />
                <Button
                  icon="pi pi-trash"
                  text
                  size="small"
                  severity="danger"
                  aria-label="Delete"
                  @click="confirmingDelete = r.id"
                />
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
