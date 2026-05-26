<script setup lang="ts">
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { Role } from "@/firebase/interfaces";

// Segmented pill toggle that lets multi-role users flip between their views
// without leaving the side panel. Mirrors the switch flow used by
// AppHeader.switchTo and AccountView.switchView — auth.switchActiveRole
// already triggers the global role-switch overlay animation.
const auth = useAuthStore();
const router = useRouter();
const toast = useToast();

const ROLE_LABEL: Record<Role, string> = {
  client: "Client",
  tradesperson: "Tradesperson",
  admin: "Admin",
};
const ROLE_ICON: Record<Role, string> = {
  client: "pi-user",
  tradesperson: "pi-wrench",
  admin: "pi-shield",
};

async function onSelect(role: Role) {
  if (auth.activeRole === role) return;
  try {
    await auth.switchActiveRole(role);
    toast.success(`Switched to ${ROLE_LABEL[role]} view`);
    router.push({ name: "Dashboard" });
  } catch (e) {
    toast.error(humanizeError(e));
  }
}
</script>

<template>
  <div v-if="auth.canSwitchRole" class="role-switcher">
    <div class="role-switcher__label">Viewing as</div>
    <div class="role-switcher__group" role="group" aria-label="Switch view">
      <button
        v-for="r in auth.roles"
        :key="r"
        type="button"
        class="role-switcher__pill"
        :class="{ 'role-switcher__pill--active': auth.activeRole === r }"
        :aria-pressed="auth.activeRole === r"
        @click="onSelect(r)"
      >
        <i :class="['pi', ROLE_ICON[r], 'role-switcher__icon']" aria-hidden="true"></i>
        <span class="role-switcher__text">{{ ROLE_LABEL[r] }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.role-switcher {
  padding: 0.5rem 0.625rem 0.75rem;
}
.role-switcher__label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--bs-muted);
  margin-bottom: 0.375rem;
}
.role-switcher__group {
  display: flex;
  gap: 0.25rem;
  padding: 0.1875rem;
  border-radius: 0.625rem;
  background: var(--bs-surface-alt);
  border: 1px solid var(--bs-border);
}
.role-switcher__pill {
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem;
  border: 0;
  border-radius: 0.4375rem;
  background: transparent;
  color: var(--bs-muted);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}
.role-switcher__pill:hover:not(.role-switcher__pill--active) {
  color: var(--bs-text);
  background: rgba(255, 255, 255, 0.6);
}
.role-switcher__pill--active {
  background: var(--bs-blue);
  color: white;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
  cursor: default;
}
.role-switcher__pill--active .role-switcher__icon {
  color: white;
}
.role-switcher__icon {
  font-size: 0.8125rem;
}
.role-switcher__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
