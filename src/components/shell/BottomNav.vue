<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useNavItems } from "@/composables/useNavItems";
import NotificationsButton from "@/components/shell/NotificationsButton.vue";
import ProfileMenu from "@/components/shell/ProfileMenu.vue";
import BlueSealMarkTall from "@/components/brand/BlueSealMarkTall.vue";

const { mobileItems, isActive } = useNavItems();
const route = useRoute();

// Unified mobile bar layout, consistent across roles:
//   [ destination ] [ destination ] [ LOGO ] [ ALERTS ] [ PROFILE ]
// Alerts (notifications) and Profile always sit together on the right; the
// role's primary destinations sit left of the centre logo. Each role exposes
// exactly two mobile destinations (useNavItems), so the bar is always 5 cells.
// Notifications is pulled out of the destination list and rendered in its
// fixed right slot rather than flowing with the others.
const leftItems = computed(() =>
  mobileItems.value.filter((i) => i.key !== "notifications"),
);
// The brand logo routes to the homepage ("/" renders it for everyone).
const isHomeActive = computed(() => route.path === "/");
</script>

<template>
  <nav class="bottom-nav" aria-label="Primary mobile">
    <RouterLink
      v-for="item in leftItems"
      :key="item.key"
      :to="item.to"
      class="bottom-tab"
      :class="{ 'bottom-tab--active': isActive(item) }"
    >
      <i :class="['pi', item.icon, 'bottom-tab__icon']" aria-hidden="true"></i>
      <span class="bottom-tab__label">{{ item.mobileLabel ?? item.label }}</span>
    </RouterLink>

    <RouterLink
      to="/"
      class="bottom-tab bottom-tab--brand"
      :class="{ 'bottom-tab--active': isHomeActive }"
      aria-label="Home"
    >
      <BlueSealMarkTall decorative class="bottom-tab__brand-icon" />
    </RouterLink>

    <NotificationsButton variant="tab" label="Alerts" />
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
  /* No vertical padding on the container — top + safe-area-bottom live on
     each tab instead, so the active tab's solid blue fill reaches the
     bar's top edge and the screen's bottom edge with no white gap. */
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
  /* Honor iOS PWA home-indicator safe area on the tab itself (was on the
     nav before) so an active tab's blue extends to the screen edge. */
  padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
  text-decoration: none;
  min-height: 48px;
  transition: color 120ms ease;
}
/* Active state is a solid blue block filling the tab cell edge-to-edge —
   no border-radius, no inset margin. Only colors change between
   active/inactive so the icon and label stay put on selection. */
.bottom-tab--active {
  color: white;
  background: var(--bs-blue);
  font-weight: 600;
}
.bottom-tab--active .bottom-tab__icon {
  color: white;
}
/* The brand/Home tab opts out of the active treatment — the Blue Seal
   logo is itself blue, so it'd vanish against the active background. */
.bottom-tab--brand.bottom-tab--active {
  background: transparent;
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
/* Brand "Home" tab in the center. Logo runs taller than the other icons
   because there's no text label under it — it has to carry the whole tab
   visually on its own. Keeps the same padding (including safe-area inset)
   as the other tabs so the bar height stays consistent and the logo sits
   above the iOS home indicator. */
.bottom-tab__brand-icon {
  height: 3rem;
  width: 3rem;
  object-fit: contain;
}
</style>
