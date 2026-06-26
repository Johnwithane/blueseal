<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import PmProfilePanel from "@/components/manage/PmProfilePanel.vue";
import PmFeaturedTradesPanel from "@/components/manage/PmFeaturedTradesPanel.vue";

useSeo({ title: "Public profile", noindex: true });

const auth = useAuthStore();
// Public page link: canonical /project-managers/:uid (works before a slug is claimed).
const publicPath = computed(() =>
  auth.fbUser ? `/project-managers/${auth.fbUser.uid}` : "/",
);
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold mb-1">Public profile</h1>
        <p class="text-sm text-[color:var(--bs-muted)]">
          Your own shareable page at a /pm/ link. Publish it to introduce yourself and the trades you
          recommend.
        </p>
      </div>
      <RouterLink :to="publicPath" target="_blank">
        <span class="text-sm text-[color:var(--bs-blue)] no-underline whitespace-nowrap">View page ↗</span>
      </RouterLink>
    </div>

    <div class="mt-5">
      <PmProfilePanel />
    </div>

    <h2 class="font-semibold flex items-center gap-2 mb-1 mt-8">
      <i class="pi pi-star text-[color:var(--bs-blue)]"></i> Featured trades
    </h2>
    <p class="text-sm text-[color:var(--bs-muted)] mb-3">
      Choose which of your saved trades appear on your public profile. They're notified and can opt
      out at any time.
    </p>
    <PmFeaturedTradesPanel />
  </section>
</template>
