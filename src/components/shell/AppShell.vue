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
//
// The shell also exposes a `--bs-content-left-offset` CSS var on its root
// element (0 on mobile, 260px on desktop where the side panel is shown).
// Any `position: fixed` sticky bar inside the shell (e.g. JobDetailView's
// "Prepare quote" CTA) can read this var to leave room for the side panel
// instead of running underneath it.
const route = useRoute();
const title = computed(() => (route.meta.title as string | undefined) ?? "");
const mobileCompact = computed(() => route.meta.mobileCompact === true);
</script>

<template>
  <div class="app-shell">
    <SidePanel class="app-shell__side" />
    <div class="app-shell__main">
      <TradieStatusBanner :class="{ 'hidden sm:block': mobileCompact }" />
      <main
        class="app-shell__content"
        :class="{ 'app-shell__content--compact': mobileCompact }"
      >
        <div
          v-if="title"
          class="bs-container flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
          :class="{ 'hidden sm:block': mobileCompact }"
        >
          <h1 class="app-shell__title">{{ title }}</h1>
          <!-- Teleport target: a view can inject a header action (e.g. the
               client's "Post a job", the admin's queue links) so it sits on
               the title row, top-right, instead of taking its own row below. -->
          <div id="app-shell-header-action" class="flex flex-wrap justify-end gap-2"></div>
        </div>
        <slot />
      </main>
    </div>
    <!-- v-if (not class) because Vue's scoped CSS specificity beats
         Tailwind's `.hidden` utility, so a class toggle would not actually
         hide the nav on mobileCompact routes. Removing it from the DOM
         altogether also drops the BottomNav subscription work. -->
    <BottomNav v-if="!mobileCompact" class="app-shell__bottom" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100dvh;
  /* Default: no side-panel offset for mobile (panel is hidden, content is
     full-width). Inherited by any `position: fixed` descendant that wants
     to leave room for the side panel via `left: var(...)`. */
  --bs-content-left-offset: 0px;
}
@media (min-width: 768px) {
  .app-shell {
    /* Matches the 260px width set in SidePanel.vue. If that changes,
       update both in lock-step. */
    --bs-content-left-offset: 260px;
  }
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
/* mobileCompact routes (/jobs/:id) hide the bottom nav, so there's nothing to
   reserve for here — the view supplies its own bottom spacing (e.g. the sticky
   CTA reserve). Without this the page would over-reserve a phantom 56px. */
.app-shell__content--compact {
  padding-bottom: 0;
}
@media (min-width: 768px) {
  .app-shell__content {
    /* Bottom nav is hidden on desktop; no padding needed. */
    padding-bottom: 0;
  }
}

.app-shell__title {
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  /* Tight on mobile to reclaim top real estate — the view's own top padding
     supplies the gap to the first card. Roomier on desktop. */
  padding-top: 0.75rem;
  padding-bottom: 0;
  color: var(--bs-text);
}
@media (min-width: 768px) {
  .app-shell__title {
    font-size: 1.75rem;
    padding-top: 1.25rem;
    padding-bottom: 0.5rem;
  }
}

/* Reclaim mobile top real-estate across every app view: the shell already
   renders the page title above the slot, so the view's own large top padding
   (py-6 / py-8) is redundant on phones and pushes content down. Tighten the
   top padding of the view's root container on mobile only — desktop keeps the
   roomier spacing each view defines. */
@media (max-width: 767px) {
  .app-shell__content :deep(section.bs-container) {
    padding-top: 0.5rem;
  }
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
