<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import Popover from "primevue/popover";
import NotificationsPanel from "@/components/NotificationsPanel.vue";
import { useNotificationsStore } from "@/stores/notifications";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { NotificationDoc, WithId } from "@/firebase/interfaces";

// Reusable trigger + popover combo. Two variants:
//   - "side"   → side-panel row layout (icon + label, full-width, left-aligned)
//   - "tab"    → bottom-bar tab layout (stacked icon over label, centered)
// Both anchor the popover to the trigger element, so the popover floats
// where the user clicked. The popover content is the same NotificationsPanel
// used by AppHeader on public pages — single source of truth.
withDefaults(
  defineProps<{
    variant: "side" | "tab";
    active?: boolean;
    // Custom label (used on the mobile tab where "Notifications" is too long).
    // Falls back to "Notifications" if not set.
    label?: string;
  }>(),
  { label: "Notifications" },
);

const notifs = useNotificationsStore();
const router = useRouter();
const toast = useToast();
const popover = ref<InstanceType<typeof Popover> | null>(null);

function toggle(e: Event) {
  popover.value?.toggle(e);
}

async function onOpen(item: WithId<NotificationDoc>) {
  popover.value?.hide();
  await notifs.onOpen(item, router);
}

async function onMarkAllRead() {
  try {
    await notifs.markAllRead();
  } catch (e) {
    toast.error(humanizeError(e));
  }
}
</script>

<template>
  <!-- Side-panel row variant: matches the SidePanel <RouterLink> item layout
       (full-width button, icon + label, bold + accent when active). -->
  <button
    v-if="variant === 'side'"
    type="button"
    class="shell-side-row"
    :class="{ 'shell-side-row--active': active }"
    :aria-label="
      notifs.unreadCount > 0
        ? `Notifications (${notifs.unreadCount} unread)`
        : 'Notifications'
    "
    @click="toggle"
  >
    <span class="relative inline-flex">
      <i class="pi pi-bell shell-side-row__icon" aria-hidden="true"></i>
      <span
        v-if="notifs.unreadCount > 0"
        class="shell-side-row__badge"
        aria-hidden="true"
      >
        {{ notifs.unreadCount > 9 ? "9+" : notifs.unreadCount }}
      </span>
    </span>
    <span class="shell-side-row__label">{{ label }}</span>
  </button>

  <!-- Bottom-bar tab variant: stacked icon-over-label, smaller hit area. -->
  <button
    v-else
    type="button"
    class="shell-tab"
    :class="{ 'shell-tab--active': active }"
    :aria-label="
      notifs.unreadCount > 0
        ? `Notifications (${notifs.unreadCount} unread)`
        : 'Notifications'
    "
    @click="toggle"
  >
    <span class="relative inline-flex">
      <i class="pi pi-bell shell-tab__icon" aria-hidden="true"></i>
      <span
        v-if="notifs.unreadCount > 0"
        class="shell-tab__badge"
        aria-hidden="true"
      >
        {{ notifs.unreadCount > 9 ? "9+" : notifs.unreadCount }}
      </span>
    </span>
    <span class="shell-tab__label">{{ label }}</span>
  </button>

  <Popover ref="popover" :pt="{ root: { style: 'max-width: 92vw;' } }">
    <NotificationsPanel
      :items="notifs.items"
      :loading="notifs.loading"
      @open="onOpen"
      @mark-all-read="onMarkAllRead"
    />
  </Popover>
</template>

<style scoped>
/* Side-panel row: mirrors the SidePanel link styling so the Notifications
   button looks identical to a real <RouterLink>. The active state is driven
   from outside (the side panel has no notion of "Notifications is active" —
   it never is, since the popover is transient). */
.shell-side-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: 0;
  background: transparent;
  border-radius: 0.5rem;
  color: var(--bs-muted);
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: color 120ms ease, background-color 120ms ease;
}
.shell-side-row:hover {
  color: var(--bs-text);
  background: var(--bs-surface-alt);
}
.shell-side-row--active {
  color: var(--bs-text);
  font-weight: 600;
}
.shell-side-row--active .shell-side-row__icon {
  color: var(--bs-blue);
}
.shell-side-row__icon {
  font-size: 1.125rem;
  color: inherit;
}
.shell-side-row__label {
  flex: 1 1 auto;
  min-width: 0;
}
.shell-side-row__badge {
  position: absolute;
  top: -4px;
  right: -8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.25rem;
  border-radius: 9999px;
  background: var(--bs-blue);
  color: white;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

/* Bottom-bar tab variant — matches BottomNav.vue's `.bottom-tab` style.
   Padding (including iOS safe-area-inset-bottom) lives on the tab so the
   active blue fill reaches the screen edge. */
.shell-tab {
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.125rem;
  border: 0;
  background: transparent;
  color: var(--bs-muted);
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 0.25rem 0.125rem;
  padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
  cursor: pointer;
  min-height: 48px;
  transition: color 120ms ease;
}
.shell-tab__label {
  line-height: 1;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Matches BottomNav.vue's `.bottom-tab--active` — solid blue block filling
   the tab cell edge-to-edge. Only colors change (no margin/radius shift)
   so the icon doesn't reposition on selection. */
.shell-tab--active {
  color: white;
  background: var(--bs-blue);
  font-weight: 600;
}
.shell-tab--active .shell-tab__icon {
  color: white;
}
.shell-tab__icon {
  font-size: 1.25rem;
  color: inherit;
}
.shell-tab__badge {
  position: absolute;
  top: -4px;
  right: -8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.25rem;
  border-radius: 9999px;
  background: var(--bs-blue);
  color: white;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}
</style>
