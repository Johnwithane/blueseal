<script setup lang="ts">
// Public profile-preview page (/p/:id). Two audiences:
//   - The tradesperson, from the outreach email: they see the profile we
//     drafted, then claim + get verified (the magic sign-in link rides in `?c=`).
//   - An admin, via the composer's "Preview profile": same page, no `c`, so the
//     claim button just explains the email link is what claims it.
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import LoadingState from "@/components/LoadingState.vue";
import { getProspectPreview, type ProspectPreview } from "@/firebase/services/prospects";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";

const route = useRoute();
const { money } = useFormatters();

const profile = ref<ProspectPreview | null>(null);
const loading = ref(true);
const error = ref(false);

const prospectId = computed(() => String(route.params.id ?? ""));
// The magic sign-in link, carried from the email so the claim button can sign
// them in. Vue has already URL-decoded the query value.
const claimLink = computed(() => (typeof route.query.c === "string" ? route.query.c : null));

onMounted(async () => {
  try {
    profile.value = await getProspectPreview(prospectId.value);
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
});

const tradesLabel = computed(() =>
  (profile.value?.trades ?? []).map((k) => tradeLabel(k)).join(" · "),
);
const yearsPrimary = computed(() => {
  const p = profile.value;
  const key = p?.trades?.[0];
  return key ? (p?.yearsExperience?.[key] ?? null) : null;
});
</script>

<template>
  <section class="bs-container py-8 max-w-2xl">
    <LoadingState v-if="loading" />

    <div v-else-if="error || !profile" class="bs-empty">
      <i class="pi pi-search mr-2" />We couldn't find that listing. It may have been removed.
    </div>

    <template v-else>
      <!-- Hero -->
      <div class="bs-card p-5 sm:p-6">
        <div class="flex items-start gap-4">
          <img
            v-if="profile.photoURL"
            :src="profile.photoURL"
            :alt="profile.displayName"
            class="h-20 w-20 rounded-xl border border-[color:var(--bs-border)] bg-white object-cover shrink-0"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-xl font-semibold">{{ profile.companyName || profile.displayName }}</h1>
              <Tag value="Pending verification" severity="secondary" />
            </div>
            <p v-if="tradesLabel" class="text-sm text-[color:var(--bs-muted)] mt-1">{{ tradesLabel }}</p>
            <p class="text-xs text-[color:var(--bs-muted)] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              <span v-if="profile.locationLabel"><i class="pi pi-map-marker mr-1" />{{ profile.locationLabel }}</span>
              <span v-if="yearsPrimary"><i class="pi pi-briefcase mr-1" />{{ yearsPrimary }} yrs</span>
              <span v-if="profile.hourlyRate"><i class="pi pi-dollar mr-1" />{{ money(profile.hourlyRate) }}/hr</span>
              <span v-if="profile.languages.length"><i class="pi pi-comments mr-1" />{{ profile.languages.join(", ") }}</span>
            </p>
          </div>
          <img
            v-if="profile.companyLogoUrl"
            :src="profile.companyLogoUrl"
            alt="Logo"
            class="h-12 w-12 rounded border border-[color:var(--bs-border)] bg-white object-contain shrink-0 hidden sm:block"
          />
        </div>

        <p v-if="profile.bio" class="text-sm mt-4 whitespace-pre-line">{{ profile.bio }}</p>

        <a
          v-if="profile.website"
          :href="profile.website"
          target="_blank"
          rel="noopener"
          class="text-sm text-[color:var(--bs-blue)] underline mt-3 inline-block"
          >{{ profile.website.replace(/^https?:\/\//, "") }}</a
        >
      </div>

      <!-- Services offered -->
      <div v-if="profile.services?.length" class="mt-4">
        <h2 class="text-sm font-semibold mb-2">Services offered</h2>
        <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <li
            v-for="(s, i) in profile.services"
            :key="i"
            class="flex items-start gap-2 rounded-md border border-[color:var(--bs-border)] bg-[color:var(--bs-surface-alt)] px-3 py-2 text-sm font-medium"
          >
            <i class="pi pi-wrench text-[color:var(--bs-muted)] mt-0.5" aria-hidden="true"></i>
            <span>{{ s }}</span>
          </li>
        </ul>
      </div>

      <!-- Portfolio -->
      <div v-if="profile.portfolioPhotos.length" class="mt-4">
        <h2 class="text-sm font-semibold mb-2">Recent work</h2>
        <ul class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <li
            v-for="(url, i) in profile.portfolioPhotos"
            :key="url"
            class="aspect-square overflow-hidden rounded-md border border-[color:var(--bs-border)]"
          >
            <img :src="url" :alt="`Work ${i + 1}`" class="h-full w-full object-cover" loading="lazy" />
          </li>
        </ul>
      </div>

      <!-- Claim CTA -->
      <div class="bs-card p-5 mt-4 text-center">
        <template v-if="profile.claimed">
          <p class="text-sm">This profile has already been claimed.</p>
        </template>
        <template v-else>
          <h2 class="text-lg font-semibold">Is this your business?</h2>
          <p class="text-sm text-[color:var(--bs-muted)] mt-1 max-w-md mx-auto">
            We built this profile for you on Blue Seal, a platform for verified Canadian
            tradespeople. Claiming is completely free. Add your trade ticket and ID to get the
            verified badge and start receiving job leads.
          </p>
          <a v-if="claimLink" :href="claimLink" class="inline-block mt-4">
            <Button label="Claim this profile & get verified" icon="pi pi-verified" />
          </a>
          <p v-else class="text-xs text-[color:var(--bs-muted)] mt-4">
            To claim it, use the secure link in the email we sent you.
          </p>
          <p class="text-[11px] text-[color:var(--bs-muted)] mt-3">
            We never charge to be listed. Blue Seal earns from payment service fees and optional
            tools, not directory fees.
          </p>
        </template>
      </div>
    </template>
  </section>
</template>
