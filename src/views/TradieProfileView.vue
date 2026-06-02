<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Rating from "primevue/rating";
import Avatar from "primevue/avatar";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { getProspect } from "@/firebase/services/prospects";
import { listReviewsFor } from "@/firebase/services/reviews";
import {
  listAcceptedVouchesFor,
  listAcceptedVouchesFrom,
} from "@/firebase/services/vouches";
import type {
  ProspectDoc,
  ReviewDoc,
  TradespersonDoc,
  VouchDoc,
  WithId,
} from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import CalendarView from "@/components/CalendarView.vue";
import VerifiedBadge from "@/components/VerifiedBadge.vue";
import ProspectProfile from "@/components/ProspectProfile.vue";
import LoadingState from "@/components/LoadingState.vue";

const route = useRoute();
const tradie = ref<WithId<TradespersonDoc> | null>(null);
// If the :uid resolves to a seeded prospect instead of a real tradesperson,
// we render the unverified ProspectProfile at this same URL (prospects share
// the /tradies/:id profile route — there's no separate /prospects/ page).
const prospect = ref<WithId<ProspectDoc> | null>(null);
const reviews = ref<WithId<ReviewDoc>[]>([]);
// Two-direction peer-endorsement chips. vouchesFrom = people this tradie
// vouches for; vouchesFor = people who've vouched for this tradie. Both
// queries hit accepted-only docs (rules permit world-read of accepted
// vouches; pending/declined are party-only).
const vouchesFrom = ref<WithId<VouchDoc>[]>([]);
const vouchesFor = ref<WithId<VouchDoc>[]>([]);
const loading = ref(true);
const { money, relativeTime } = useFormatters();
const auth = useAuthStore();
const toast = useToast();

const displayName = computed(() => tradie.value?.displayName?.trim() || "");
const avatarInitial = computed(() => {
  const source = displayName.value || tradeLabel(tradie.value?.trades[0] ?? "");
  return source.slice(0, 1).toUpperCase() || "?";
});

// Trades with their experience years, primary first. Used to render the
// header subtitle ("Plumber · Electrician") and a per-trade chip strip
// with years of experience so clients see the full picture, not just the
// primary trade.
const tradesWithYears = computed(() => {
  const t = tradie.value;
  if (!t) return [];
  return t.trades.map((key) => ({
    key,
    label: tradeLabel(key),
    years: t.yearsExperience?.[key] ?? null,
    verified: t.verifiedTrades?.includes(key) ?? false,
  }));
});

// Trust-badge visibility — auto-hides once expiresAt passes so the badge
// disappears without admin intervention when a policy or clearance lapses.
const insuranceLive = computed(() => {
  if (!tradie.value?.insuranceVerified) return false;
  const exp = tradie.value.insuranceExpiresAt?.toDate?.().getTime();
  return exp == null || exp > Date.now();
});
const wsibLive = computed(() => {
  if (!tradie.value?.wsibVerified) return false;
  const exp = tradie.value.wsibExpiresAt?.toDate?.().getTime();
  return exp == null || exp > Date.now();
});

const shareUrl = computed(() => {
  if (typeof window === "undefined") return "";
  return window.location.href;
});

async function share() {
  if (!tradie.value) return;
  const url = shareUrl.value;
  const tradesText = tradie.value.trades.map((t) => tradeLabel(t)).join(" · ");
  const title = displayName.value
    ? `${displayName.value} — ${tradesText} on Blue Seal`
    : `${tradesText} on Blue Seal`;
  // Prefer native share sheet on mobile; fall back to clipboard everywhere else.
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({ url, title });
      return;
    } catch {
      /* user cancelled — fall through to clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  } catch {
    toast.error("Couldn't copy link");
  }
}

const isOwnProfile = computed(
  () => !!auth.fbUser && auth.fbUser.uid === (route.params.uid as string),
);

function vouchInitial(name: string): string {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

// Display helpers for the reviews list. Legacy reviews written before
// clientName/clientPhotoURL were denormalized fall back to a generic
// "Client" label + "C" initial — keeps the row from rendering an empty
// circle while staying honest that we don't know who wrote it.
function reviewerName(r: WithId<ReviewDoc>): string {
  return r.clientName?.trim() || "Client";
}
function reviewerInitial(r: WithId<ReviewDoc>): string {
  return reviewerName(r).slice(0, 1).toUpperCase();
}

onMounted(async () => {
  const uid = route.params.uid as string;
  try {
    // getTradesperson REJECTS (not resolves null) when the doc isn't publicly
    // readable: a prospect id (no tradespeople doc), or a draft/rejected
    // profile a non-owner can't read — the tradespeople read rule has no
    // resource==null clause, so getDoc throws permission-denied. Treat any such
    // failure as "not a readable tradie" and fall through to the prospect
    // lookup, instead of letting the rejection hang the page on "Loading…".
    const t = await getTradesperson(uid).catch(() => null);
    if (t) {
      tradie.value = t;
      // Reviews + vouches only apply to real tradies; fetch them in parallel.
      const [r, vFrom, vFor] = await Promise.all([
        listReviewsFor(uid),
        listAcceptedVouchesFrom(uid),
        listAcceptedVouchesFor(uid),
      ]);
      reviews.value = r;
      vouchesFrom.value = vFrom;
      vouchesFor.value = vFor;
    } else {
      // Not a readable tradesperson — maybe a seeded prospect on this route.
      prospect.value = await getProspect(uid).catch(() => null);
    }
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <!-- Prospect (seeded, unverified) profile shares this route — render its full
       body instead of the tradesperson layout when the id resolves to one. -->
  <ProspectProfile v-if="!loading && prospect" :prospect="prospect" />
  <section v-else class="bs-container py-6">
    <LoadingState v-if="loading" />
    <div v-else-if="!tradie" class="bs-empty">
      <i class="pi pi-times-circle text-3xl mb-2 block"></i>
      <p>Profile not found.</p>
    </div>
    <template v-else>
      <!-- Preview banner — only the owner sees this, and only while the
           profile isn't publicly visible (pre-vetting or admin-suspended).
           Rules let the owner read their own doc regardless of isVisible,
           so the page renders fine but clients can't reach it yet. -->
      <div
        v-if="isOwnProfile && !tradie.isVisible"
        class="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3"
      >
        <i class="pi pi-eye text-lg mt-0.5 text-amber-700" aria-hidden="true"></i>
        <div class="text-sm">
          <div class="font-semibold text-amber-900">Preview mode</div>
          <p class="text-amber-900/80">
            This is how your profile will look — it isn't visible to clients
            until your trade certification + ID are approved.
          </p>
        </div>
      </div>

      <header class="bs-card p-5">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar
            v-if="tradie.photoURL"
            :image="tradie.photoURL"
            size="xlarge"
            shape="circle"
          />
          <Avatar
            v-else
            :label="avatarInitial"
            size="xlarge"
            shape="circle"
            style="background-color: var(--bs-blue); color: white; font-weight: 700;"
          />
          <div class="flex-1 min-w-0">
            <h1 class="text-2xl font-bold">{{ displayName || tradeLabel(tradie.trades[0]) }}</h1>
            <div v-if="tradie.companyName" class="text-sm text-[color:var(--bs-muted)]">
              {{ tradie.companyName }}
            </div>
            <div class="mt-1 text-sm text-[color:var(--bs-muted)]">
              {{ tradesWithYears.map((t) => t.label).join(" · ") }}
              <!-- Home/street address removed from the public profile — it's
                   private now (tradespeople/{uid}/private/contact). The service
                   radius still conveys coverage without exposing where they
                   live. -->
              <span v-if="tradie.serviceRadiusKm"> • {{ tradie.serviceRadiusKm }} km radius</span>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-1">
              <Tag v-if="tradie.idVerified" value="ID verified" severity="success" />
              <VerifiedBadge
                v-if="insuranceLive"
                kind="insurance"
                :expires-at="tradie.insuranceExpiresAt"
              />
              <VerifiedBadge
                v-if="wsibLive"
                kind="wsib"
                :expires-at="tradie.wsibExpiresAt"
              />
            </div>
            <div v-if="tradesWithYears.length" class="mt-2 flex flex-wrap items-center gap-1">
              <span
                v-for="t in tradesWithYears"
                :key="t.key"
                class="bs-pill"
                :class="{ verified: t.verified }"
              >
                <i v-if="t.verified" class="pi pi-verified"></i>
                {{ t.label }}
                <span v-if="t.years" class="opacity-75">· {{ t.years }}y</span>
              </span>
            </div>
            <div
              v-if="tradie.languages && tradie.languages.length"
              class="mt-2 text-xs text-[color:var(--bs-muted)]"
            >
              <i class="pi pi-comments mr-1"></i>
              Speaks {{ tradie.languages.join(", ") }}
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              label="Share"
              icon="pi pi-share-alt"
              severity="secondary"
              outlined
              @click="share"
            />
            <RouterLink
              v-if="auth.isAuthenticated && auth.hasClientRole"
              :to="{ name: 'RequestQuote', params: { uid: tradie.id } }"
            >
              <Button label="Request a quote" icon="pi pi-send" />
            </RouterLink>
            <RouterLink v-else-if="!auth.isAuthenticated" :to="{ name: 'SignUp' }">
              <Button label="Sign up to contact" icon="pi pi-user-plus" />
            </RouterLink>
          </div>
        </div>
      </header>

      <div class="grid lg:grid-cols-3 gap-4 mt-4">
        <section class="bs-card p-5 lg:col-span-2 space-y-3">
          <h2 class="font-semibold">About</h2>
          <p class="text-sm whitespace-pre-wrap">{{ tradie.bio }}</p>
          <div class="text-sm text-[color:var(--bs-muted)]">
            Pricing:
            <strong class="text-[color:var(--bs-text)]">
              {{ tradie.hourlyRate ? money(tradie.hourlyRate) + "/hr" : "Quote on request" }}
              <span v-if="tradie.providesFreeQuotes"> • Free quotes</span>
            </strong>
          </div>
        </section>

        <section class="bs-card p-5">
          <h2 class="font-semibold mb-2">Rating</h2>
          <div class="text-3xl font-bold">
            {{ tradie.ratingCount ? tradie.ratingAvg.toFixed(1) : "—" }}
            <span class="text-sm text-[color:var(--bs-muted)]">/ 5</span>
          </div>
          <div class="text-xs text-[color:var(--bs-muted)] mb-3">
            {{ tradie.ratingCount }} review{{ tradie.ratingCount === 1 ? "" : "s" }}
          </div>
          <ul class="text-sm space-y-1">
            <li v-for="(dim, k) in tradie.ratingDimensions" :key="k" class="flex justify-between">
              <span class="capitalize">{{ k }}</span>
              <Rating :model-value="Math.round(dim.avg)" readonly :cancel="false" />
            </li>
          </ul>
        </section>
      </div>

      <section
        v-if="tradie.portfolioPhotos.length"
        class="bs-card p-5 mt-4"
      >
        <h2 class="font-semibold mb-3">Portfolio</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <img
            v-for="(url, i) in tradie.portfolioPhotos"
            :key="i"
            :src="url"
            :alt="`Portfolio photo ${i + 1}`"
            class="aspect-square w-full rounded-md object-cover"
            loading="lazy"
          />
        </div>
      </section>

      <section class="bs-card p-5 mt-4">
        <h2 class="font-semibold mb-2">Availability</h2>
        <p class="mb-3 text-xs text-[color:var(--bs-muted)]">
          Weekly availability pattern — toggle to month view to plan ahead.
        </p>
        <CalendarView :jobs="[]" :availability="tradie.weeklyAvailability" />
      </section>

      <section
        v-if="vouchesFrom.length || vouchesFor.length || isOwnProfile"
        class="bs-card p-5 mt-4"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <h2 class="font-semibold">Recommendations</h2>
          <RouterLink v-if="isOwnProfile" :to="{ name: 'AccountRecommendations' }">
            <Button
              label="Manage"
              icon="pi pi-pencil"
              size="small"
              text
            />
          </RouterLink>
        </div>

        <div v-if="vouchesFor.length" class="mb-3">
          <div class="mb-1 text-xs font-semibold uppercase text-[color:var(--bs-muted)]">
            Recommended by
          </div>
          <ul class="flex flex-wrap gap-2">
            <li v-for="v in vouchesFor" :key="v.id">
              <RouterLink
                :to="{ name: 'TradieProfile', params: { uid: v.fromUserId } }"
                :title="v.message || ''"
                class="bs-pill verified inline-flex items-center gap-1 hover:underline"
              >
                <Avatar
                  v-if="v.fromPhotoURL"
                  :image="v.fromPhotoURL"
                  shape="circle"
                  size="small"
                />
                <Avatar
                  v-else
                  :label="vouchInitial(v.fromDisplayName)"
                  shape="circle"
                  size="small"
                  style="background-color: var(--bs-blue); color: white;"
                />
                <span>{{ v.fromDisplayName }}</span>
                <span
                  v-if="v.fromPrimaryTrade"
                  class="text-xs opacity-75"
                >· {{ tradeLabel(v.fromPrimaryTrade) }}</span>
              </RouterLink>
            </li>
          </ul>
        </div>

        <div v-if="vouchesFrom.length">
          <div class="mb-1 text-xs font-semibold uppercase text-[color:var(--bs-muted)]">
            Recommends
          </div>
          <ul class="flex flex-wrap gap-2">
            <li v-for="v in vouchesFrom" :key="v.id">
              <RouterLink
                v-if="v.toUserId"
                :to="{ name: 'TradieProfile', params: { uid: v.toUserId } }"
                :title="v.message || ''"
                class="bs-pill inline-flex items-center gap-1 hover:underline"
              >
                <Avatar
                  v-if="v.toPhotoURL"
                  :image="v.toPhotoURL"
                  shape="circle"
                  size="small"
                />
                <Avatar
                  v-else
                  :label="vouchInitial(v.toDisplayName)"
                  shape="circle"
                  size="small"
                  style="background-color: var(--bs-blue); color: white;"
                />
                <span>{{ v.toDisplayName }}</span>
                <span
                  v-if="v.toPrimaryTrade"
                  class="text-xs opacity-75"
                >· {{ tradeLabel(v.toPrimaryTrade) }}</span>
              </RouterLink>
            </li>
          </ul>
        </div>

        <div
          v-if="isOwnProfile && !vouchesFrom.length && !vouchesFor.length"
          class="text-sm text-[color:var(--bs-muted)]"
        >
          No recommendations yet —
          <RouterLink
            :to="{ name: 'AccountRecommendations' }"
            class="text-[color:var(--bs-blue)] hover:underline"
          >recommend tradespeople you've worked with</RouterLink>
          to build out your network.
        </div>
      </section>

      <section class="bs-card p-5 mt-4">
        <h2 class="font-semibold mb-2">Reviews</h2>
        <div v-if="!reviews.length" class="text-sm text-[color:var(--bs-muted)]">No reviews yet.</div>
        <article
          v-for="r in reviews"
          :key="r.id"
          class="border-t py-3 first:border-t-0 first:pt-0"
        >
          <!-- Reviewer header: avatar + name on the left, relative
               timestamp on the right. Avatar falls back to the
               reviewer's initial when no photoURL is available
               (legacy review docs that pre-date denormalization OR
               clients who signed up without a profile photo). -->
          <header class="flex items-start justify-between gap-3 mb-1">
            <div class="flex items-center gap-2 min-w-0">
              <Avatar
                v-if="r.clientPhotoURL"
                :image="r.clientPhotoURL"
                shape="circle"
                size="small"
              />
              <Avatar
                v-else
                :label="reviewerInitial(r)"
                shape="circle"
                size="small"
                class="!bg-[color:var(--bs-blue)]/10 !text-[color:var(--bs-blue)] font-semibold"
              />
              <div class="min-w-0">
                <div class="text-sm font-medium truncate">{{ reviewerName(r) }}</div>
                <Rating
                  :model-value="r.rating"
                  readonly
                  :cancel="false"
                  class="review-row__rating"
                />
              </div>
            </div>
            <span class="text-xs text-[color:var(--bs-muted)] flex-none">
              {{ relativeTime(r.createdAt) }}
            </span>
          </header>
          <p v-if="r.text" class="text-sm mt-2">{{ r.text }}</p>
        </article>
      </section>
    </template>
  </section>
</template>

<style scoped>
/* Amber stars on the review row rating to match the modal + revealed
   reviews — the brand green default reads as "approved" rather than
   "rating." Smaller size since the reviewer name is the headline,
   stars are secondary. */
.review-row__rating :deep(.p-rating-icon),
.review-row__rating :deep(.p-icon),
.review-row__rating :deep(.p-rating-on-icon) {
  color: #f59e0b !important;
  fill: #f59e0b !important;
}
.review-row__rating :deep(.p-rating-icon),
.review-row__rating :deep(.p-icon) {
  width: 0.875rem;
  height: 0.875rem;
  font-size: 0.875rem;
}
</style>
