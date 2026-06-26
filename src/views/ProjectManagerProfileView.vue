<script setup lang="ts">
// Public Project Manager profile (P5): chromeless page at /pm/<slug> (vanity) and
// /project-managers/:uid (canonical). World-readable once the PM publishes it
// (isVisible — instant, no vetting). Brand + bio for P5a; featured preferred
// contractors arrive in P5b. Mirrors TradieProfileView's resolve + owner-preview
// pattern, much simplified.
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import { getPmProfile, resolvePmSlugToUid } from "@/firebase/services/pmProfile";
import type { ProjectManagerProfileDoc, WithId } from "@/firebase/interfaces";

const route = useRoute();
const auth = useAuthStore();

const profile = ref<WithId<ProjectManagerProfileDoc> | null>(null);
const status = ref<"loading" | "ready" | "not_found">("loading");

const isOwner = computed(() => !!auth.fbUser && profile.value?.id === auth.fbUser.uid);
const name = computed(
  () => profile.value?.companyName?.trim() || profile.value?.displayName?.trim() || "Project manager",
);
const accent = computed(() => profile.value?.brandColor || "var(--bs-blue)");

useSeo(
  computed(() => ({
    title: status.value === "ready" ? name.value : "Project manager",
    // Don't index unpublished/owner-preview profiles.
    noindex: !(profile.value?.isVisible === true),
  })),
);

async function load() {
  status.value = "loading";
  let uid = (route.params.uid as string | undefined) ?? null;
  const slug = route.params.slug as string | undefined;
  if (!uid && slug) uid = await resolvePmSlugToUid(slug);
  if (!uid) {
    status.value = "not_found";
    return;
  }
  const p = await getPmProfile(uid);
  // Visible to the world only when published; the owner can preview their own.
  if (!p || (!p.isVisible && auth.fbUser?.uid !== uid)) {
    status.value = "not_found";
    return;
  }
  profile.value = p;
  status.value = "ready";
}

onMounted(load);
watch(() => [route.params.slug, route.params.uid], load);
</script>

<template>
  <div class="min-h-screen bg-[color:var(--bs-surface)]">
    <div v-if="status === 'loading'" class="bs-container py-16 text-center text-[color:var(--bs-muted)]">
      Loading…
    </div>

    <div v-else-if="status === 'not_found'" class="bs-container py-16 text-center">
      <i class="pi pi-user text-3xl text-[color:var(--bs-muted)] mb-2 block"></i>
      <p class="font-semibold">Profile not found</p>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        This project manager profile doesn't exist or isn't published.
      </p>
    </div>

    <template v-else-if="profile">
      <!-- Hero -->
      <div
        class="h-40 sm:h-56 w-full bg-cover bg-center"
        :style="
          profile.coverUrl
            ? { backgroundImage: `url(${profile.coverUrl})` }
            : { background: accent }
        "
      ></div>

      <div class="bs-container -mt-10 pb-12 max-w-2xl">
        <div class="bs-card p-5">
          <div v-if="isOwner && !profile.isVisible" class="mb-3">
            <Message severity="info" :closable="false">
              This is a preview. Your profile is hidden until you publish it from the cockpit.
            </Message>
          </div>

          <div class="flex items-center gap-4">
            <img
              v-if="profile.companyLogoUrl"
              :src="profile.companyLogoUrl"
              :alt="name"
              class="h-16 w-16 rounded-lg object-cover border border-[color:var(--bs-border)]"
            />
            <div
              v-else
              class="h-16 w-16 rounded-lg flex items-center justify-center text-white text-2xl font-bold"
              :style="{ background: accent }"
            >
              {{ name.slice(0, 1).toUpperCase() }}
            </div>
            <div class="min-w-0">
              <h1 class="text-2xl font-bold truncate">{{ name }}</h1>
              <p class="text-sm text-[color:var(--bs-muted)]">Project manager on Blue Seal</p>
            </div>
          </div>

          <p v-if="profile.bio" class="mt-4 text-sm whitespace-pre-line">{{ profile.bio }}</p>

          <div class="mt-5 h-1 w-16 rounded-full" :style="{ background: accent }"></div>
          <p class="mt-4 text-xs text-[color:var(--bs-muted)]">
            This project manager coordinates trusted trades for clients on Blue Seal, verified
            tradespeople with the whole job (chat, quotes, invoices) in one place.
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
