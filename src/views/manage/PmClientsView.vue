<script setup lang="ts">
// All my clients (Project Manager CRM). Repurposes the tradesperson Clients
// surface (Pro gate + search + list), but a PM's clients are DERIVED from their
// projects — each project carries clientName, clientId (once claimed), an invite
// email, and a status — so there's no separate clients collection to read. Whole
// surface is Blue Seal Pro, the same subscription tradespeople use.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/auth";
import { useSubscriptionStore } from "@/stores/subscription";
import { useSeo } from "@/composables/useSeo";
import { subscribeProjectsForPm } from "@/firebase/services/projects";
import type { ProjectDoc, WithId } from "@/firebase/interfaces";
import InitialsAvatar from "@/components/InitialsAvatar.vue";

useSeo({ title: "Clients", noindex: true });

const auth = useAuthStore();
const store = useSubscriptionStore();
const { isPro, loaded: subLoaded } = storeToRefs(store);
const isAdmin = computed(() => (auth.roles ?? []).includes("admin"));
const gated = computed(() => subLoaded.value && !isPro.value && !isAdmin.value);

const projects = ref<WithId<ProjectDoc>[]>([]);
const search = ref("");
let unsub: (() => void) | null = null;

function start() {
  if (!auth.fbUser || gated.value) return;
  unsub?.();
  unsub = subscribeProjectsForPm(auth.fbUser.uid, (p) => (projects.value = p));
}
onMounted(start);
onUnmounted(() => unsub?.());

interface PmClient {
  key: string;
  name: string;
  email: string;
  total: number;
  active: number; // not declined/cancelled
}

// Group projects into one row per client. Prefer the claimed clientId as the key
// (most stable), else the invite email, else a normalized name.
const clients = computed<PmClient[]>(() => {
  const byKey = new Map<string, PmClient>();
  for (const p of projects.value) {
    const email = p.projectInvite?.emailLower ?? "";
    const key = p.clientId ?? email ?? p.clientName.trim().toLowerCase();
    if (!key) continue;
    const existing = byKey.get(key);
    const isActive = p.status !== "declined" && p.status !== "cancelled";
    if (existing) {
      existing.total += 1;
      if (isActive) existing.active += 1;
      if (!existing.email && email) existing.email = email;
    } else {
      byKey.set(key, {
        key,
        name: p.clientName || email || "Client",
        email,
        total: 1,
        active: isActive ? 1 : 0,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return clients.value;
  return clients.value.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q));
});
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <h1 class="text-2xl font-bold mb-1">Clients</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mb-4">
      Everyone you've set up work for, gathered from your projects.
    </p>

    <!-- Pro gate (whole surface), same subscription as the tradesperson tools. -->
    <div v-if="gated" class="bs-card p-6 text-center">
      <i class="pi pi-lock text-3xl text-[color:var(--bs-blue)]"></i>
      <h2 class="mt-3 text-lg font-semibold">Your client book is part of Blue Seal Pro</h2>
      <p class="mt-2 text-sm text-[color:var(--bs-muted)] max-w-sm mx-auto">
        See every client you manage in one place, with how many projects each has on the go.
      </p>
      <RouterLink to="/pricing" class="inline-block mt-5">
        <Button label="Start 30-day free trial" icon="pi pi-star" />
      </RouterLink>
    </div>

    <template v-else>
      <InputText v-model="search" placeholder="Search clients…" class="w-full mb-3" />

      <ul v-if="filtered.length" class="space-y-2">
        <li v-for="c in filtered" :key="c.key" class="bs-card p-3 flex items-center gap-3">
          <InitialsAvatar :name="c.name" :size="36" />
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate">{{ c.name }}</div>
            <div v-if="c.email" class="text-xs text-[color:var(--bs-muted)] truncate">{{ c.email }}</div>
          </div>
          <span class="text-xs text-[color:var(--bs-muted)] shrink-0">
            {{ c.active }} active · {{ c.total }} total
          </span>
        </li>
      </ul>
      <div v-else-if="clients.length" class="bs-card p-6 text-center text-sm text-[color:var(--bs-muted)]">
        No clients match "{{ search }}".
      </div>
      <div v-else class="bs-card p-6 text-center">
        <i class="pi pi-users text-2xl text-[color:var(--bs-blue)]"></i>
        <p class="mt-2 font-medium">No clients yet</p>
        <p class="text-sm text-[color:var(--bs-muted)]">
          Set up a project for a client and they'll show up here.
        </p>
      </div>
    </template>
  </section>
</template>
