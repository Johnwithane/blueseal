<script setup lang="ts">
import { RouterLink } from "vue-router";
import { useNavItems } from "@/composables/useNavItems";
import NotificationsButton from "@/components/shell/NotificationsButton.vue";
import ProfileMenu from "@/components/shell/ProfileMenu.vue";

const { mobileItems, isActive } = useNavItems();
</script>

<template>
  <nav class="bottom-nav" aria-label="Primary mobile">
    <template v-for="item in mobileItems" :key="item.key">
      <NotificationsButton
        v-if="item.key === 'notifications'"
        variant="tab"
        :label="item.mobileLabel ?? item.label"
      />
      <RouterLink
        v-else
        :to="item.to"
        class="bottom-tab"
        :class="{ 'bottom-tab--active': isActive(item) }"
      >
        <i :class="['pi', item.icon, 'bottom-tab__icon']" aria-hidden="true"></i>
        <span class="bottom-tab__label">{{ item.mobileLabel ?? item.label }}</span>
      </RouterLink>
    </template>
    <ProfileMenu variant="tab" />
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  align-items: stretch;
  gap: 0;
  background: white;
  border-top: 1px solid var(--bs-border);
  /* Honor iOS PWA home-indicator safe area; mirrors JobDetailView.vue:703. */
  padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
  padding-top: 0.25rem;
}

.bottom-tab {
  flex: 1 1 0;
  /* min-width: 0 lets flex shrink each tab below its content width so the
     5-tab bar always fits a 375px viewport (otherwise a long label like
     "My applications" would force the tab to its natural width and overflow). */
  min-width: 0;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.125rem;
  color: var(--bs-muted);
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 0.25rem 0.125rem;
  text-decoration: none;
  min-height: 48px;
  transition: color 120ms ease;
}
.bottom-tab--active {
  color: var(--bs-text);
  font-weight: 600;
}
.bottom-tab--active .bottom-tab__icon {
  color: var(--bs-blue);
}
.bottom-tab__icon {
  font-size: 1.25rem;
  color: inherit;
}
.bottom-tab__label {
  line-height: 1;
  /* Truncate labels that don't fit on tiny widths rather than wrapping. */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
