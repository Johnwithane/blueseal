<script setup lang="ts">
// The Clients tab body (rendered inside TradieDashboard at ?view=clients). The
// whole surface is Blue Seal Pro: non-Pro tradespeople see the gate screen
// (mirrors ReportsView). Pro tradespeople get the searchable client book with
// add + import. Recurring billing lives one level deeper, on each client.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/auth";
import { useSubscriptionStore } from "@/stores/subscription";
import { subscribeClients } from "@/firebase/services/clientsService";
import type { ClientDoc, WithId } from "@/firebase/interfaces";
import ClientListItem from "@/components/clients/ClientListItem.vue";
import ClientFormDialog from "@/components/clients/ClientFormDialog.vue";
import ClientImportDialog from "@/components/clients/ClientImportDialog.vue";

const auth = useAuthStore();
const store = useSubscriptionStore();
const { isPro, loaded: subLoaded } = storeToRefs(store);
const isAdmin = computed(() => (auth.roles ?? []).includes("admin"));
const gated = computed(() => subLoaded.value && !isPro.value && !isAdmin.value);

const clients = ref<WithId<ClientDoc>[]>([]);
const search = ref("");
const addOpen = ref(false);
const importOpen = ref(false);
let unsub: (() => void) | null = null;

function start() {
  if (!auth.fbUser || gated.value) return;
  unsub?.();
  unsub = subscribeClients(auth.fbUser.uid, (c) => (clients.value = c));
}

onMounted(start);
onUnmounted(() => unsub?.());

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return clients.value;
  return clients.value.filter((c) =>
    [c.displayName, c.emailLower, c.company, c.phone]
      .filter((v): v is string => !!v)
      .some((v) => v.toLowerCase().includes(q)),
  );
});
</script>

<template>
  <!-- Pro gate (whole-tab) -->
  <div v-if="gated" class="bs-card p-6 text-center">
    <i class="pi pi-lock text-3xl text-[color:var(--bs-blue)]"></i>
    <h2 class="mt-3 text-lg font-semibold">Clients are part of Blue Seal Pro</h2>
    <p class="mt-2 text-sm text-[color:var(--bs-muted)] max-w-sm mx-auto">
      Keep your whole client book in one place and put your regulars on recurring
      billing that Blue Seal drafts for you to review and send each period.
    </p>
    <RouterLink to="/pricing" class="inline-block mt-5">
      <Button label="Start 30-day free trial" icon="pi pi-star" />
    </RouterLink>
  </div>

  <template v-else>
    <div class="flex items-center gap-2 mb-3">
      <InputText
        v-model="search"
        placeholder="Search clients…"
        class="flex-1 min-w-0"
      />
      <Button
        label="Import"
        icon="pi pi-upload"
        size="small"
        outlined
        @click="importOpen = true"
      />
      <Button label="Add" icon="pi pi-plus" size="small" @click="addOpen = true" />
    </div>

    <ul v-if="filtered.length" class="space-y-2">
      <ClientListItem v-for="c in filtered" :key="c.id" :client="c" />
    </ul>
    <div v-else-if="clients.length" class="bs-empty">
      <p>No clients match "{{ search }}".</p>
    </div>
    <div v-else class="bs-empty">
      <i class="pi pi-users text-3xl mb-2 block text-[color:var(--bs-blue)]"></i>
      <p>Your client book is empty. Add a client, or import your existing list.</p>
      <div class="flex justify-center gap-2 mt-3">
        <Button label="Import CSV" icon="pi pi-upload" outlined @click="importOpen = true" />
        <Button label="Add client" icon="pi pi-plus" @click="addOpen = true" />
      </div>
    </div>

    <ClientFormDialog v-model:visible="addOpen" />
    <ClientImportDialog v-model:visible="importOpen" />
  </template>
</template>
