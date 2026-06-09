<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Message from "primevue/message";
import type { RebateProgramDoc, WithId } from "@/firebase/interfaces";
import {
  deleteRebateProgram,
  importSeedRebatePrograms,
  listRebatePrograms,
} from "@/firebase/services/rebatePrograms";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import LoadingState from "@/components/LoadingState.vue";
import RebateCard from "@/components/RebateCard.vue";
import AdminRebateProgramForm from "@/components/admin/AdminRebateProgramForm.vue";

// Admin CRUD for the curated rebate/grant programs surfaced in the post-a-job
// flow. Self-contained (no Pinia), mirrors AdminSiteContentView. Before the
// collection is seeded the list shows the read-only code fallback — "Import
// starter set" copies it into Firestore so it becomes editable.
const toast = useToast();

const programs = ref<WithId<RebateProgramDoc>[]>([]);
const loading = ref(true);
const importing = ref(false);
const editing = ref<WithId<RebateProgramDoc> | null>(null);
const adding = ref(false);
const confirmingDelete = ref<string | null>(null);

// When every row is the code-seeded fallback, the live collection is still
// empty — steer the admin to import before editing so they don't strand the
// other previews behind a single hand-added doc.
const seedMode = computed(
  () => programs.value.length > 0 && programs.value.every((p) => p.updatedBy === "seed"),
);

onMounted(load);

async function load() {
  loading.value = true;
  try {
    programs.value = await listRebatePrograms();
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

function startEdit(p: WithId<RebateProgramDoc>) {
  adding.value = false;
  editing.value = p;
}

function closeForm() {
  adding.value = false;
  editing.value = null;
}

async function onSaved() {
  closeForm();
  await load();
}

async function runImport() {
  importing.value = true;
  try {
    const n = await importSeedRebatePrograms();
    toast.success("Imported", n > 0 ? `${n} program(s) added.` : "Everything was already imported.");
    await load();
  } catch (e) {
    toast.error("Import failed", humanizeError(e));
  } finally {
    importing.value = false;
  }
}

async function confirmDelete(slug: string) {
  try {
    await deleteRebateProgram(slug);
    toast.success("Deleted", "Program removed.");
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
      <h1 class="text-lg font-semibold">Rebate programs</h1>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        Government & utility rebate/grant programs surfaced to clients when they post an
        energy-relevant job. Keep these accurate — clients see the amounts, eligibility and
        "verified" date. We never claim eligibility; each links out to the official source.
      </p>
    </header>

    <Message v-if="seedMode" severity="info" :closable="false" class="mb-4">
      Showing the built-in starter set. Import it into the live database to edit, add, or
      remove programs.
    </Message>

    <div class="flex flex-wrap gap-2 mb-4">
      <Button
        label="Import starter set"
        icon="pi pi-download"
        outlined
        :loading="importing"
        @click="runImport"
      />
      <Button
        label="Add program"
        icon="pi pi-plus"
        :disabled="seedMode || adding"
        @click="startAdd"
      />
    </div>

    <AdminRebateProgramForm
      v-if="adding"
      :program="null"
      class="mb-4"
      @saved="onSaved"
      @cancel="closeForm"
    />

    <LoadingState v-if="loading" />

    <div v-else class="space-y-4">
      <div v-for="p in programs" :key="p.id">
        <AdminRebateProgramForm
          v-if="editing && editing.id === p.id"
          :program="p"
          @saved="onSaved"
          @cancel="closeForm"
        />
        <div v-else>
          <RebateCard :program="p" />
          <div v-if="!seedMode" class="flex items-center justify-end gap-1 mt-1">
            <template v-if="confirmingDelete === p.slug">
              <span class="text-xs text-[color:var(--bs-muted)] mr-1">Delete this program?</span>
              <Button label="Cancel" text size="small" @click="confirmingDelete = null" />
              <Button label="Delete" severity="danger" size="small" @click="confirmDelete(p.slug)" />
            </template>
            <template v-else>
              <Button icon="pi pi-pencil" text size="small" label="Edit" @click="startEdit(p)" />
              <Button
                icon="pi pi-trash"
                text
                size="small"
                severity="danger"
                aria-label="Delete"
                @click="confirmingDelete = p.slug"
              />
            </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
