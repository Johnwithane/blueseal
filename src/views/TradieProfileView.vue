<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Rating from "primevue/rating";
import Avatar from "primevue/avatar";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { listReviewsFor } from "@/firebase/services/reviews";
import type { ReviewDoc, TradespersonDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import CalendarView from "@/components/CalendarView.vue";

const route = useRoute();
const tradie = ref<WithId<TradespersonDoc> | null>(null);
const reviews = ref<WithId<ReviewDoc>[]>([]);
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

onMounted(async () => {
  const uid = route.params.uid as string;
  tradie.value = await getTradesperson(uid);
  reviews.value = await listReviewsFor(uid);
  loading.value = false;
});
</script>

<template>
  <section class="bs-container py-6">
    <div v-if="loading" class="bs-empty">Loading…</div>
    <div v-else-if="!tradie" class="bs-empty">
      <i class="pi pi-times-circle text-3xl mb-2 block"></i>
      <p>Profile not found.</p>
    </div>
    <template v-else>
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
              <span v-if="tradie.primaryAddressText"> • {{ tradie.primaryAddressText }}</span>
              <span v-if="tradie.serviceRadiusKm"> • {{ tradie.serviceRadiusKm }} km radius</span>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-1">
              <Tag v-if="tradie.idVerified" value="ID verified" severity="success" />
              <Tag v-if="insuranceLive" value="Insured" severity="info" icon="pi pi-verified" />
              <Tag v-if="wsibLive" value="WSIB verified" severity="info" icon="pi pi-shield" />
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

      <section class="bs-card p-5 mt-4">
        <h2 class="font-semibold mb-2">Reviews</h2>
        <div v-if="!reviews.length" class="text-sm text-[color:var(--bs-muted)]">No reviews yet.</div>
        <article v-for="r in reviews" :key="r.id" class="border-t py-3 first:border-t-0 first:pt-0">
          <div class="flex items-center justify-between">
            <Rating :model-value="r.rating" readonly :cancel="false" />
            <span class="text-xs text-[color:var(--bs-muted)]">{{ relativeTime(r.createdAt) }}</span>
          </div>
          <p class="text-sm mt-1">{{ r.text }}</p>
        </article>
      </section>
    </template>
  </section>
</template>
