<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Select from "primevue/select";
import Slider from "primevue/slider";
import Tag from "primevue/tag";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { useNotificationsStore } from "@/stores/notifications";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { subscribeJobPostFeed } from "@/firebase/services/jobPosts";
import { subscribeMyApplications } from "@/firebase/services/applications";
import type {
  ApplicationDoc,
  JobPostDoc,
  TradespersonDoc,
  WithId,
} from "@/firebase/interfaces";
import { TRADES, tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables";
import JobCounterparty from "@/components/JobCounterparty.vue";
import LoadingState from "@/components/LoadingState.vue";
import ReferJobDialog from "@/components/jobPost/ReferJobDialog.vue";

const auth = useAuthStore();
const notifs = useNotificationsStore();
const { relativeTime } = useFormatters();

const tradie = ref<WithId<TradespersonDoc> | null>(null);
const loadingTradie = ref(true);
const posts = ref<WithId<JobPostDoc>[]>([]);
const appliedPostIds = ref<Set<string>>(new Set());

// The exact service-area point is now private; the public tradesperson doc
// carries only locationApprox (~1 km). (0,0) is the "not set yet" sentinel
// written by onboarding, so treat it as unset.
const hasServiceArea = computed(
  () => !!tradie.value?.locationApprox && tradie.value.locationApprox.latitude !== 0,
);

const tradeFilter = ref<string | "any">("any");
const radiusKm = ref(25);

let unsubFeed: (() => void) | null = null;
let unsubApps: (() => void) | null = null;

const tradeOptions = computed(() => [
  { label: "Any trade", value: "any" },
  ...TRADES.map((t) => ({ label: t.label, value: t.key })),
]);

onMounted(async () => {
  if (!auth.fbUser) return;
  // They're looking at the board now — clear the "new jobs in your area"
  // badge. Fire-and-forget; don't block the feed load on the reset write.
  notifs.resetJobBoardCount();
  tradie.value = await getTradesperson(auth.fbUser.uid);
  loadingTradie.value = false;

  if (!tradie.value || !tradie.value.isVisible || !hasServiceArea.value) return;

  // Default trade filter to primary trade.
  tradeFilter.value = tradie.value.trades[0] ?? "any";

  // Track this tradie's own applications so we can filter the feed.
  unsubApps = subscribeMyApplications(auth.fbUser.uid, (apps: WithId<ApplicationDoc>[]) => {
    appliedPostIds.value = new Set(apps.map((a) => a.postId));
  });

  startFeed();
});

watch([tradeFilter, radiusKm], () => {
  if (tradie.value?.isVisible && hasServiceArea.value) startFeed();
});

function startFeed() {
  unsubFeed?.();
  if (!tradie.value || !hasServiceArea.value) return;
  const center = {
    lat: tradie.value.locationApprox.latitude,
    lng: tradie.value.locationApprox.longitude,
  };
  unsubFeed = subscribeJobPostFeed(
    {
      trade: tradeFilter.value === "any" ? null : tradeFilter.value,
      center,
      radiusKm: radiusKm.value,
    },
    (p) => (posts.value = p),
  );
}

onUnmounted(() => {
  unsubFeed?.();
  unsubApps?.();
});

const visiblePosts = computed(() =>
  posts.value.filter((p) => !appliedPostIds.value.has(p.id) && p.clientId !== auth.fbUser?.uid),
);

const urgencyTone: Record<string, "info" | "warn" | "danger"> = {
  flexible: "info",
  this_week: "warn",
  urgent: "danger",
};

function formatBudget(min: number, max: number): string {
  const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
  return `${fmt(min)}–${fmt(max)}`;
}

function urgencyLabel(u: string): string {
  if (u === "this_week") return "This week";
  if (u === "urgent") return "Urgent";
  return "Flexible";
}

// One shared refer dialog for the whole feed — the share button on each card
// just swaps which post it targets.
const referPost = ref<WithId<JobPostDoc> | null>(null);
const showRefer = ref(false);

function openRefer(post: WithId<JobPostDoc>) {
  referPost.value = post;
  showRefer.value = true;
}
</script>

<template>
  <section class="bs-container py-6">
    <p class="text-[color:var(--bs-muted)]">
      Jobs posted by clients in your area. Apply with a message and your proposed price.
    </p>

    <LoadingState v-if="loadingTradie" class="mt-6" label="Loading your profile…" />

    <Message
      v-else-if="!tradie?.isVisible && tradie?.vettingStatus === 'approved'"
      severity="info"
      :closable="false"
      class="mt-6"
    >
      <strong>Application approved.</strong>
      Our team still needs to verify your
      <template v-if="!tradie?.idVerified && (tradie?.verifiedTrades?.length ?? 0) === 0">
        ID and at least one certification
      </template>
      <template v-else-if="!tradie?.idVerified">ID</template>
      <template v-else>certification</template>
      before your profile goes live. You'll get a notification when it's done — no further action needed from you.
    </Message>

    <Message v-else-if="!tradie?.isVisible" severity="info" :closable="false" class="mt-6">
      <strong>Vetting in progress.</strong>
      You'll be able to browse and apply to open jobs once your application is approved (typically 1–2 business days).
    </Message>

    <Message v-else-if="!hasServiceArea" severity="warn" :closable="false" class="mt-6">
      <strong>Service area not set.</strong>
      We need your address and service radius to show jobs near you.
      <RouterLink :to="{ name: 'Account' }" class="underline ml-1">Update your profile</RouterLink>
      to start browsing.
    </Message>

    <template v-else>
      <div class="bs-card p-4 mt-4 grid sm:grid-cols-2 gap-4">
        <div>
          <label class="text-sm font-medium">Trade</label>
          <Select
            v-model="tradeFilter"
            :options="tradeOptions"
            option-label="label"
            option-value="value"
            class="mt-1 w-full"
          />
        </div>
        <div>
          <label class="text-sm font-medium">Within {{ radiusKm }} km</label>
          <Slider v-model="radiusKm" :min="5" :max="100" class="mt-2 w-full" />
        </div>
      </div>

      <div v-if="visiblePosts.length === 0" class="bs-empty mt-6">
        <i class="pi pi-megaphone text-3xl mb-2 block"></i>
        <p>
          No matching posts right now. Try expanding your radius
          <template v-if="tradeFilter !== 'any'">, picking "Any trade",</template>
          or check back later.
        </p>
      </div>

      <div v-else class="grid sm:grid-cols-2 gap-4 mt-6">
        <RouterLink
          v-for="post in visiblePosts"
          :key="post.id"
          :to="{ name: 'JobPostDetail', params: { postId: post.id } }"
          class="bs-card p-5 hover:shadow-md transition-shadow no-underline text-inherit"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="font-semibold truncate">{{ post.title }}</div>
              <div class="text-xs text-[color:var(--bs-muted)]">
                {{ tradeLabel(post.trade) }} • {{ relativeTime(post.createdAt) }}
              </div>
            </div>
            <Tag :value="urgencyLabel(post.urgency)" :severity="urgencyTone[post.urgency] ?? 'info'" />
          </div>
          <div class="mt-3">
            <JobCounterparty
              role="client"
              size="small"
              :name="post.clientName"
              :photo-url="post.clientPhotoURL"
            />
          </div>
          <p class="text-sm mt-2 text-[color:var(--bs-muted)] line-clamp-3">{{ post.description }}</p>
          <div class="mt-3 flex items-center justify-between text-xs">
            <span class="text-[color:var(--bs-muted)]">
              <i class="pi pi-map-marker mr-1"></i>
              {{ post.addressPublic.city }}, {{ post.addressPublic.region }}
            </span>
            <span class="flex items-center gap-1">
              <span class="font-medium">
                {{ formatBudget(post.budget.min, post.budget.max) }}
              </span>
              <Button
                icon="pi pi-share-alt"
                text
                rounded
                size="small"
                severity="secondary"
                :aria-label="`Refer ${post.title} to another tradesperson`"
                @click.stop.prevent="openRefer(post)"
              />
            </span>
          </div>
        </RouterLink>
      </div>

      <ReferJobDialog v-if="referPost" v-model:visible="showRefer" :post="referPost" />
    </template>
  </section>
</template>
