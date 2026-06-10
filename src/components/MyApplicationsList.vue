<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import { subscribeMyApplications } from "@/firebase/services/applications";
import type { ApplicationDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables";

// Renders the signed-in tradesperson's job-board applications grouped by
// status. Used in two places: the standalone /my-applications route (a thin
// wrapper) and the "Applied" view inside TradieDashboard. The list itself is
// the same in both contexts — the difference is just the surrounding chrome.
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
  declined: "secondary",
  withdrawn: "warn",
};

const grouped = computed(() => {
  const order: ApplicationDoc["status"][] = [
    "pending",
    "selected",
    "rejected",
    "declined",
    "withdrawn",
  ];
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
  if (s === "declined") return "Declined";
  return "Withdrawn";
}

function priceLabel(p: ApplicationDoc["proposedPrice"]): string {
  const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
  return p.type === "fixed" ? fmt(p.amount) : `${fmt(p.amount)}/hr`;
}

const myUid = computed(() => auth.fbUser?.uid ?? null);
function unreadFor(a: WithId<ApplicationDoc>): number {
  return myUid.value ? (a.threadUnreadCounts?.[myUid.value] ?? 0) : 0;
}
</script>

<template>
  <div>
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
      <p v-else-if="group.status === 'declined'" class="text-xs text-[color:var(--bs-muted)] mb-2">
        The client passed on these quotes. Open one to see why and revise it back into the running.
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
            <div class="flex items-center gap-1.5">
              <Tag v-if="unreadFor(a) > 0" value="New message" severity="danger" />
              <Tag :value="statusLabel(a.status)" :severity="statusSeverity[a.status] ?? 'info'" />
            </div>
          </div>
          <p class="text-sm mt-2 line-clamp-2">{{ a.message }}</p>
          <p
            v-if="a.status === 'declined' && a.declinedReason"
            class="text-xs text-amber-800 mt-2 line-clamp-2"
          >
            Client: “{{ a.declinedReason }}”
          </p>
          <div class="text-xs text-[color:var(--bs-muted)] mt-2">
            Proposed: {{ priceLabel(a.proposedPrice) }}
          </div>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
