<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import SidePanel from "@/components/shell/SidePanel.vue";
import BottomNav from "@/components/shell/BottomNav.vue";
import TradieStatusBanner from "@/components/TradieStatusBanner.vue";

// The authenticated-area layout. Wraps a route view (passed via the default
// slot) with a side panel on desktop and a bottom nav on mobile. The shell
// reads `route.meta.title` and renders it as the page heading so views no
// longer need to render their own h1.
//
// On `meta.mobileCompact` routes (currently /jobs/:id) we hide the bottom
// nav and the title so the underlying view can claim the full viewport on
// phones — the chat composer + sticky CTA need that space.
const route = useRoute();
const title = computed(() => (route.meta.title as string | undefined) ?? "");
const mobileCompact = computed(() => route.meta.mobileCompact === true);
</script>

<template>
  <div class="app-shell">
    <SidePanel class="app-shell__side" />
    <div class="app-shell__main">
      <TradieStatusBanner :class="{ 'hidden sm:block': mobileCompact }" />
      <main class="app-shell__content">
        <div
          v-if="title"
          class="bs-container"
          :class="{ 'hidden sm:block': mobileCompact }"
        >
          <h1 class="app-shell__title">{{ title }}</h1>
        </div>
        <slot />
      </main>
    </div>
    <BottomNav class="app-shell__bottom" :class="{ 'hidden sm:hidden': mobileCompact }" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100dvh;
}

.app-shell__side {
  /* Hidden on mobile; the bottom nav takes over below md. */
  display: none;
}
@media (min-width: 768px) {
  .app-shell__side {
    display: flex;
  }
}

.app-shell__main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.app-shell__content {
  flex: 1 1 auto;
  /* Reserve room for the fixed bottom nav on mobile so the last row of
     content isn't covered. 56px = bar height (48 + 8 padding) + safe area. */
  padding-bottom: calc(56px + env(safe-area-inset-bottom));
}
@media (min-width: 768px) {
  .app-shell__content {
    /* Bottom nav is hidden on desktop; no padding needed. */
    padding-bottom: 0;
  }
}

.app-shell__title {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  padding-top: 1rem;
  padding-bottom: 0.5rem;
  color: var(--bs-text);
}

.app-shell__bottom {
  display: flex;
}
@media (min-width: 768px) {
  .app-shell__bottom {
    display: none;
  }
}
</style>
