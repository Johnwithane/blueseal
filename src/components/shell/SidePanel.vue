<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useNavItems } from "@/composables/useNavItems";
import { useAuthStore } from "@/stores/auth";
import NotificationsButton from "@/components/shell/NotificationsButton.vue";
import ProfileMenu from "@/components/shell/ProfileMenu.vue";
import RoleSwitcher from "@/components/shell/RoleSwitcher.vue";
import BlueSealLockup from "@/components/brand/BlueSealLockup.vue";

const { sideItems, isActive } = useNavItems();
const auth = useAuthStore();

// Help is a role-agnostic utility link pinned to the footer (just above the
// profile) rather than a primary nav item — the conventional spot for it.
// Active for the Help Center and any article under /help/:slug.
const route = useRoute();
const helpActive = computed(
  () => route.path === "/help" || route.path.startsWith("/help/"),
);
// QA toolkit footer link — only for staff holding the qa capability. Sits with
// the other footer utilities; qa is a capability, not a view-mode, so it isn't a
// primary nav item.
const qaActive = computed(() => route.path === "/qa");
</script>

<template>
  <aside class="side-panel">
    <!-- Logo + brand → the homepage (root), per product convention that the
         logo always goes home. The role "Jobs"/"Dashboard" nav item covers
         the in-app home. -->
    <RouterLink to="/" class="side-panel__brand" aria-label="Blue Seal home">
      <BlueSealLockup class="side-panel__brand-logo" />
    </RouterLink>

    <nav class="side-panel__nav" aria-label="Primary">
      <template v-for="item in sideItems" :key="item.key">
        <NotificationsButton
          v-if="item.key === 'notifications'"
          variant="side"
        />
        <RouterLink
          v-else
          :to="item.to"
          class="side-row"
          :class="{ 'side-row--active': isActive(item) }"
        >
          <i :class="['pi', item.icon, 'side-row__icon']" aria-hidden="true"></i>
          <span class="side-row__label">{{ item.label }}</span>
        </RouterLink>
      </template>
    </nav>

    <!-- Footer utility link, pinned below the scrollable nav. Help sits just
         above the role switcher / profile so it's always reachable without
         hunting through the primary nav. -->
    <RouterLink
      v-if="auth.hasQaRole"
      to="/qa"
      class="side-row side-panel__help"
      :class="{ 'side-row--active': qaActive }"
    >
      <i class="pi pi-bug side-row__icon" aria-hidden="true"></i>
      <span class="side-row__label">QA toolkit</span>
    </RouterLink>

    <RouterLink
      to="/help"
      class="side-row side-panel__help"
      :class="{ 'side-row--active': helpActive }"
    >
      <i class="pi pi-question-circle side-row__icon" aria-hidden="true"></i>
      <span class="side-row__label">Help</span>
    </RouterLink>

    <!-- Multi-role users get a segmented pill toggle just above the profile
         row. The component self-hides when the user holds only one role. -->
    <RoleSwitcher />

    <div class="side-panel__profile">
      <ProfileMenu variant="side" />
    </div>
  </aside>
</template>

<style scoped>
.side-panel {
  position: sticky;
  /* Sticks below the global clock banner when one is showing; the var is 0px
     otherwise, so this matches the prior `top: 0` / full-height behaviour. */
  top: var(--bs-clock-banner-h, 0px);
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--bs-clock-banner-h, 0px));
  width: 260px;
  padding: 1rem 0.75rem;
  padding-top: max(1rem, env(safe-area-inset-top));
  border-right: 1px solid var(--bs-border);
  background: white;
}

.side-panel__brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  margin-bottom: 0.5rem;
  color: inherit;
  text-decoration: none;
}
.side-panel__brand-logo {
  height: 2rem;
  width: auto;
  display: block;
}

.side-panel__nav {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  overflow-y: auto;
  margin-top: 0.5rem;
}

.side-panel__profile {
  padding-top: 0.5rem;
  margin-top: 0.5rem;
  border-top: 1px solid var(--bs-border);
}

/* Help footer link: a hair of breathing room from the nav above it so it
   doesn't butt against the list when the nav scrolls. */
.side-panel__help {
  margin-top: 0.25rem;
}

.side-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  color: var(--bs-muted);
  font-size: 0.9375rem;
  font-weight: 500;
  text-decoration: none;
  transition: color 120ms ease, background-color 120ms ease;
}
.side-row:hover {
  color: var(--bs-text);
  background: var(--bs-surface-alt);
}
/* Active row: solid blue pill with white text/icon. Beats the previous
   subtle-bold styling, which was too easy to miss against the white panel
   background. The active state still wins over hover because `:hover` only
   sets background (this rule is more specific). */
.side-row--active,
.side-row--active:hover {
  color: white;
  background: var(--bs-blue);
  font-weight: 600;
}
.side-row--active .side-row__icon {
  color: white;
}
.side-row__icon {
  font-size: 1.125rem;
  color: inherit;
}
.side-row__label {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
