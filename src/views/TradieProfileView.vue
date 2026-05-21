<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Rating from "primevue/rating";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { listReviewsFor } from "@/firebase/services/reviews";
import type { ReviewDoc, TradespersonDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";
import { useAuthStore } from "@/stores/auth";
import CalendarView from "@/components/CalendarView.vue";

const route = useRoute();
const tradie = ref<WithId<TradespersonDoc> | null>(null);
const reviews = ref<WithId<ReviewDoc>[]>([]);
const loading = ref(true);
const { money, relativeTime } = useFormatters();
const auth = useAuthStore();

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
        <div class="flex items-start gap-4">
          <div class="h-16 w-16 rounded-full bg-[color:var(--bs-blue)] text-white flex items-center justify-center text-2xl font-bold">
            {{ tradie.id.slice(0, 1).toUpperCase() }}
          </div>
          <div class="flex-1 min-w-0">
            <h1 class="text-xl font-bold flex items-center gap-2 flex-wrap">
              {{ tradeLabel(tradie.trades[0]) }}
              <Tag v-if="tradie.idVerified" value="ID verified" severity="success" />
            </h1>
            <div class="text-sm text-[color:var(--bs-muted)]">
              {{ tradie.primaryAddressText }} • {{ tradie.serviceRadiusKm }} km radius
            </div>
            <div class="flex flex-wrap gap-1 mt-2">
              <span v-for="t in tradie.verifiedTrades" :key="t" class="bs-pill verified">
                <i class="pi pi-verified"></i>{{ tradeLabel(t) }}
              </span>
            </div>
          </div>
          <RouterLink
            v-if="auth.isAuthenticated && auth.role === 'client'"
            :to="{ name: 'RequestQuote', params: { uid: tradie.id } }"
          >
            <Button label="Request a quote" icon="pi pi-send" />
          </RouterLink>
          <RouterLink v-else-if="!auth.isAuthenticated" :to="{ name: 'SignUp' }">
            <Button label="Sign up to contact" icon="pi pi-user-plus" />
          </RouterLink>
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

      <section class="bs-card p-5 mt-4">
        <h2 class="font-semibold mb-2">Availability</h2>
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
