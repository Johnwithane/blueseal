<script setup lang="ts">
// Per-client page (CRM — Blue Seal Pro). Header with contact info + private
// notes (edit via the shared form dialog, archive/restore), then the job
// history rollup. Recurring billing attaches here in Phase C
// (ClientRecurringList). Reached from the dashboard Clients tab; Pro-gated.
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import Button from "primevue/button";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/auth";
import { useSubscriptionStore } from "@/stores/subscription";
import { getClient, setClientArchived } from "@/firebase/services/clientsService";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { useSeo } from "@/composables/useSeo";
import type { ClientDoc, WithId } from "@/firebase/interfaces";
import ClientFormDialog from "@/components/clients/ClientFormDialog.vue";
import ClientHistory from "@/components/clients/ClientHistory.vue";
import ClientRecurringList from "@/components/clients/ClientRecurringList.vue";
import InitialsAvatar from "@/components/InitialsAvatar.vue";

useSeo({ title: "Client — Blue Seal", noindex: true });

const route = useRoute();
const auth = useAuthStore();
const store = useSubscriptionStore();
const { isPro, loaded: subLoaded } = storeToRefs(store);
const toast = useToast();

const isAdmin = computed(() => (auth.roles ?? []).includes("admin"));
const gated = computed(() => subLoaded.value && !isPro.value && !isAdmin.value);
const clientId = computed(() => String(route.params.id));

const client = ref<WithId<ClientDoc> | null>(null);
const loading = ref(true);
const editOpen = ref(false);
const archiving = ref(false);

const contactLines = computed(() => {
  const c = client.value;
  if (!c) return [];
  return [c.company, c.emailLower, c.phone, c.address?.line1].filter(Boolean) as string[];
});

async function load() {
  if (gated.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    client.value = await getClient(clientId.value);
  } catch (e) {
    toast.error("Couldn't load client", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function toggleArchive() {
  if (!client.value) return;
  archiving.value = true;
  try {
    const next = !client.value.archivedAt;
    await setClientArchived(client.value.id, next);
    toast.success(next ? "Client archived" : "Client restored");
    await load();
  } catch (e) {
    toast.error(humanizeError(e));
  } finally {
    archiving.value = false;
  }
}
</script>

<template>
  <section class="bs-container py-5 max-w-2xl">
    <RouterLink
      to="/dashboard?view=clients"
      class="inline-flex items-center gap-1 text-sm text-[color:var(--bs-blue-dark)] mb-4"
    >
      <i class="pi pi-arrow-left text-xs"></i> Clients
    </RouterLink>

    <div v-if="gated" class="bs-card p-6 text-center">
      <i class="pi pi-lock text-3xl text-[color:var(--bs-blue)]"></i>
      <h2 class="mt-3 text-lg font-semibold">Clients are part of Blue Seal Pro</h2>
      <RouterLink to="/pricing" class="inline-block mt-5">
        <Button label="Start 30-day free trial" icon="pi pi-star" />
      </RouterLink>
    </div>

    <div v-else-if="loading" class="bs-card p-6 text-sm text-[color:var(--bs-muted)]">
      <i class="pi pi-spin pi-spinner mr-2"></i> Loading…
    </div>

    <div v-else-if="!client" class="bs-empty">
      <i class="pi pi-question-circle text-3xl mb-2 block"></i>
      <p>This client couldn't be found.</p>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="bs-card p-4 mb-4">
        <div class="flex items-start gap-3">
          <InitialsAvatar :name="client.displayName" :size="48" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-lg font-bold">{{ client.displayName }}</h1>
              <span
                v-if="client.archivedAt"
                class="text-[10px] font-semibold rounded-full bg-[color:var(--bs-border)] text-[color:var(--bs-muted)] px-2 py-0.5"
              >
                Archived
              </span>
            </div>
            <p v-for="line in contactLines" :key="line" class="text-sm text-[color:var(--bs-muted)]">
              {{ line }}
            </p>
          </div>
        </div>

        <p v-if="client.notes" class="mt-3 text-sm whitespace-pre-wrap border-t pt-3">
          {{ client.notes }}
        </p>

        <div class="flex flex-wrap gap-2 mt-3">
          <Button label="Edit" icon="pi pi-pencil" size="small" outlined @click="editOpen = true" />
          <Button
            :label="client.archivedAt ? 'Restore' : 'Archive'"
            :icon="client.archivedAt ? 'pi pi-replay' : 'pi pi-inbox'"
            size="small"
            text
            severity="secondary"
            :loading="archiving"
            @click="toggleArchive"
          />
        </div>
      </div>

      <!-- Recurring billing (Pro) -->
      <div class="bs-card p-4 mb-4">
        <ClientRecurringList :tradie-uid="client.tradespersonId" :client-id="client.id" />
      </div>

      <!-- History -->
      <div class="bs-card p-4">
        <ClientHistory :tradie-uid="client.tradespersonId" :client-id="client.id" />
      </div>

      <ClientFormDialog v-model:visible="editOpen" :client="client" @saved="load" />
    </template>
  </section>
</template>
