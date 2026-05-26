<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import Avatar from "primevue/avatar";
import { useAuthStore } from "@/stores/auth";

// Two visual variants — both are now plain RouterLinks to /account rather
// than dropdown triggers. Role-switching, payouts management, account
// settings, and sign-out all live INSIDE the account view (Privacy &
// account tab handles roles + sign-out; the new Payouts tab handles
// Stripe). The previous popup-menu version added an extra click for what's
// really a single destination.
//   - "side" → wide bottom-of-side-panel row: avatar + display name
//   - "tab"  → bottom-bar 5th tab: stacked avatar over "Profile" label
defineProps<{
  variant: "side" | "tab";
}>();

const auth = useAuthStore();
const route = useRoute();

const avatarInitial = computed(() => {
  const name = auth.user?.displayName?.trim();
  return (name || "?").slice(0, 1).toUpperCase();
});

// Highlight when the user is on /account (any tab) but NOT on
// /account/vouches — that's the Recommendations item in the side panel
// and shouldn't double-highlight here.
const isActive = computed(() => route.path === "/account");
</script>

<template>
  <RouterLink
    v-if="variant === 'side'"
    to="/account"
    class="profile-row"
    :class="{ 'profile-row--active': isActive }"
    :aria-label="auth.user?.displayName ?? 'Account'"
  >
    <Avatar
      v-if="auth.user?.photoURL"
      :image="auth.user.photoURL"
      size="normal"
      shape="circle"
    />
    <Avatar
      v-else
      :label="avatarInitial"
      size="normal"
      shape="circle"
      style="background-color: var(--bs-blue); color: white; font-weight: 600;"
    />
    <span class="profile-row__name">
      {{ auth.user?.displayName ?? "Account" }}
    </span>
  </RouterLink>

  <RouterLink
    v-else
    to="/account"
    class="profile-tab"
    :class="{ 'profile-tab--active': isActive }"
    aria-label="Account"
  >
    <Avatar
      v-if="auth.user?.photoURL"
      :image="auth.user.photoURL"
      size="normal"
      shape="circle"
    />
    <Avatar
      v-else
      :label="avatarInitial"
      size="normal"
      shape="circle"
      style="background-color: var(--bs-blue); color: white; font-weight: 600; width: 1.5rem; height: 1.5rem; font-size: 0.75rem;"
    />
    <span class="profile-tab__label">Profile</span>
  </RouterLink>
</template>

<style scoped>
.profile-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.5rem 0.625rem;
  background: transparent;
  border: 0;
  border-radius: 0.5rem;
  color: var(--bs-text);
  text-align: left;
  text-decoration: none;
  transition: background-color 120ms ease;
}
.profile-row:hover {
  background: var(--bs-surface-alt);
}
.profile-row--active {
  background: var(--bs-surface-alt);
}
.profile-row__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-tab {
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
  text-decoration: none;
  min-height: 48px;
  transition: color 120ms ease;
}
/* Matches BottomNav.vue's `.bottom-tab--active` — solid blue block. Only
   colors change so the avatar and label stay put on selection. */
.profile-tab--active {
  color: white;
  background: var(--bs-blue);
  font-weight: 600;
}
.profile-tab__label {
  line-height: 1;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
