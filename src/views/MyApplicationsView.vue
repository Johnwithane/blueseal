<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import { subscribeMyApplications } from "@/firebase/services/applications";
import type { ApplicationDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables";

const auth = useAuthStore();
const { relativeTime } = useFormatters();
const apps = ref<WithId<ApplicationDoc>[]>([]);
let unsub: (() => void) | null = null;

onMounted(() => {
  if (auth.fbUser) {
    unsub = subscribeMyApplications(auth.fbUser.uid, (a) => (apps.value = a));
  }
});

onUnmounted(() => unsub?.());

const statusSeverity: Record<string, "info" | "success" | "warn" | "danger" | "secondary"> = {
  pending: "info",
  selected: "success",
  rejected: "secondary",
  withdrawn: "warn",
};

const grouped = computed(() => {
  const order: ApplicationDoc["status"][] = ["pending", "selected", "rejected", "withdrawn"];
  const buckets = new Map<ApplicationDoc["status"], WithId<ApplicationDoc>[]>();
  for (const o of order) buckets.set(o, []);
  for (const a of apps.value) {
    buckets.get(a.status)?.push(a);
  }
  return order
    .map((status) => ({ status, items: buckets.get(status) ?? [] }))
    .filter((g) => g.items.length > 0);
});

function statusLabel(s: ApplicationDoc["status"]): string {
  if (s === "pending") return "Pending";
  if (s === "selected") return "Selected";
  if (s === "rejected") return "Not chosen";
  return "Withdrawn";
}

function priceLabel(p: ApplicationDoc["proposedPrice"]): string {
  const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
  return p.type === "fixed" ? fmt(p.amount) : `${fmt(p.amount)}/hr`;
}
</script>

<template>
  <section class="bs-container py-6 max-w-3xl">
    <h1 class="text-2xl font-bold">My applications</h1>
    <p class="text-[color:var(--bs-muted)]">Jobs you've applied to, grouped by status.</p>

    <div v-if="apps.length === 0" class="bs-empty mt-6">
      <i class="pi pi-inbox text-3xl mb-2 block"></i>
      <p>You haven't applied to any jobs yet.</p>
      <RouterLink to="/jobs/browse" class="text-[color:var(--bs-blue)] underline">
        Browse open jobs →
      </RouterLink>
    </div>

    <div v-for="group in grouped" :key="group.status" class="mt-6">
      <div class="flex items-center gap-2 mb-2">
        <h2 class="text-lg font-semibold">{{ statusLabel(group.status) }}</h2>
        <Tag :value="group.items.length" severity="secondary" />
      </div>
      <p v-if="group.status === 'rejected'" class="text-xs text-[color:var(--bs-muted)] mb-2">
        The client chose another tradesperson. Keep applying — your next match is out there.
      </p>
      <div class="grid sm:grid-cols-2 gap-3">
        <RouterLink
          v-for="a in group.items"
          :key="a.id"
          :to="{ name: 'JobPostDetail', params: { postId: a.postId } }"
          class="bs-card p-4 no-underline text-inherit hover:shadow-md transition-shadow"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="text-sm text-[color:var(--bs-muted)]">
              Applied {{ relativeTime(a.createdAt) }}
            </div>
            <Tag :value="statusLabel(a.status)" :severity="statusSeverity[a.status] ?? 'info'" />
          </div>
          <p class="text-sm mt-2 line-clamp-2">{{ a.message }}</p>
          <div class="text-xs text-[color:var(--bs-muted)] mt-2">
            Proposed: {{ priceLabel(a.proposedPrice) }}
          </div>
        </RouterLink>
      </div>
    </div>
  </section>
</template>
