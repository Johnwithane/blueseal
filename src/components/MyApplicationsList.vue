<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import { subscribeMyApplications } from "@/firebase/services/applications";
import { getJobPost } from "@/firebase/services/jobPosts";
import type { ApplicationDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables";

// Renders the signed-in tradesperson's job-board applications grouped by
// status. Used in two places: the standalone /my-applications route (a thin
// wrapper) and the "Applied" view inside TradieDashboard. The list itself is
// the same in both contexts — the difference is just the surrounding chrome.
const auth = useAuthStore();
const { relativeTime } = useFormatters();
const apps = ref<WithId<ApplicationDoc>[]>([]);
let unsub: (() => void) | null = null;

interface JobBrief {
  title: string;
  trade: string;
  city: string;
}

// Fallback post details for legacy applications created before submitApplication
// denormalized the post identity onto the application doc. Only fetchable while
// the post is still open (rules), which covers the pending cards that matter
// most; closed-post legacy cards simply omit the title.
const fetchedPosts = ref<Record<string, JobBrief | null>>({});

function briefFor(a: WithId<ApplicationDoc>): JobBrief | null {
  if (a.postTitle) {
    return { title: a.postTitle, trade: a.postTrade ?? "", city: a.postCity ?? "" };
  }
  return fetchedPosts.value[a.postId] ?? null;
}

async function hydrateMissing(list: WithId<ApplicationDoc>[]) {
  const missing = [
    ...new Set(list.filter((a) => !a.postTitle).map((a) => a.postId)),
  ].filter((id) => !(id in fetchedPosts.value));
  if (!missing.length) return;
  // Seed null first so a rapid second snapshot doesn't double-fetch.
  const seed = { ...fetchedPosts.value };
  for (const id of missing) seed[id] = null;
  fetchedPosts.value = seed;
  await Promise.all(
    missing.map(async (id) => {
      try {
        const p = await getJobPost(id);
        if (p) {
          fetchedPosts.value = {
            ...fetchedPosts.value,
            [id]: { title: p.title, trade: p.trade, city: p.addressPublic?.city ?? "" },
          };
        }
      } catch {
        /* post closed / unreadable — leave null, card degrades gracefully */
      }
    }),
  );
}

onMounted(() => {
  if (auth.fbUser) {
    unsub = subscribeMyApplications(auth.fbUser.uid, (a) => {
      apps.value = a;
      void hydrateMissing(a);
    });
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

// Mirrors ApplicantCard.priceSummary: chat-first and site-visit applications
// have no real price yet — a bare "Proposed: $0" would mislead.
function summaryLine(a: WithId<ApplicationDoc>): string {
  if (a.kind === "chat" && !a.quote) return "Chat first — quote to follow";
  if (a.kind === "site_visit") {
    const cents = a.siteVisitFee?.feeCents ?? a.proposedPrice.amount;
    return cents > 0
      ? `Site visit · ${priceLabel({ type: "fixed", amount: cents })}`
      : "Free site visit";
  }
  return `Proposed: ${priceLabel(a.proposedPrice)}`;
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
          <template v-if="briefFor(a)">
            <div class="font-semibold text-[color:var(--bs-text)] line-clamp-1">
              {{ briefFor(a)!.title }}
            </div>
            <div class="text-xs text-[color:var(--bs-muted)] mb-1">
              {{ tradeLabel(briefFor(a)!.trade)
              }}<template v-if="briefFor(a)!.city"> · {{ briefFor(a)!.city }}</template>
            </div>
          </template>
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
            class="text-xs text-[color:var(--bs-warning-text)] mt-2 line-clamp-2"
          >
            Client: “{{ a.declinedReason }}”
          </p>
          <div class="text-xs text-[color:var(--bs-muted)] mt-2">
            {{ summaryLine(a) }}
          </div>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
