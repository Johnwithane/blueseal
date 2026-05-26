<script setup lang="ts">
import { RouterLink } from "vue-router";
import { useNavItems } from "@/composables/useNavItems";
import NotificationsButton from "@/components/shell/NotificationsButton.vue";
import ProfileMenu from "@/components/shell/ProfileMenu.vue";
import RoleSwitcher from "@/components/shell/RoleSwitcher.vue";

const { sideItems, isActive } = useNavItems();
</script>

<template>
  <aside class="side-panel">
    <!-- Logo + brand. Clicks land the user on the marketing homepage; the
         "Jobs" / "Dashboard" item below covers the in-app home. -->
    <RouterLink to="/" class="side-panel__brand">
      <img src="/icons/blueseal_logo.png" alt="" class="h-8 w-auto" />
      <span class="side-panel__brand-text">Blue Seal</span>
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
  top: 0;
  display: flex;
  flex-direction: column;
  height: 100dvh;
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
.side-panel__brand-text {
  font-family: var(--bs-font-logo);
  font-size: 1.5rem;
  color: var(--bs-blue-dark);
  letter-spacing: 0.02em;
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
