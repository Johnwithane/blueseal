<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import Select from "primevue/select";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { roleViewMeta, type ViewRole } from "@/data/roleViews";

// Dropdown that lets multi-role users flip between their views without leaving
// the side panel. Mirrors the switch flow used by AppHeader and AccountView —
// auth.switchActiveRole already triggers the global role-switch overlay
// animation. Self-hides when the user holds only one view.
const auth = useAuthStore();
const router = useRouter();
const toast = useToast();

// One option per held view, carrying its shared label + icon.
const options = computed(() =>
  auth.viewRoles.map((r) => ({ value: r, ...roleViewMeta(r) })),
);

// Label + icon for the currently active view (what the closed dropdown shows).
const current = computed(() =>
  auth.activeRole ? roleViewMeta(auth.activeRole) : null,
);

async function onSelect(role: ViewRole) {
  // Select fires on programmatic value sync too — ignore no-op selections.
  if (!role || auth.activeRole === role) return;
  try {
    await auth.switchActiveRole(role);
    toast.success(`Switched to ${roleViewMeta(role).label} view`);
    router.push({ name: "Dashboard" });
  } catch (e) {
    toast.error(humanizeError(e));
  }
}
</script>

<template>
  <div v-if="auth.viewRoles.length > 1" class="role-switcher">
    <label for="role-switcher-select" class="role-switcher__label">Viewing as</label>
    <!-- Controlled (one-way :model-value): switchActiveRole owns auth.activeRole,
         so a failed switch leaves the dropdown showing the unchanged view. -->
    <Select
      input-id="role-switcher-select"
      :model-value="auth.activeRole"
      :options="options"
      option-label="label"
      option-value="value"
      class="role-switcher__select"
      aria-label="Switch view"
      @update:model-value="onSelect"
    >
      <template #value>
        <span v-if="current" class="role-switcher__row">
          <i :class="[current.icon, 'role-switcher__icon']" aria-hidden="true"></i>
          <span class="role-switcher__text">{{ current.label }}</span>
        </span>
      </template>
      <template #option="{ option }">
        <span class="role-switcher__row">
          <i :class="[option.icon, 'role-switcher__icon']" aria-hidden="true"></i>
          <span class="role-switcher__text">{{ option.label }}</span>
        </span>
      </template>
    </Select>
  </div>
</template>

<style scoped>
.role-switcher {
  padding: 0.5rem 0.625rem 0.75rem;
}
.role-switcher__label {
  display: block;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--bs-muted);
  margin-bottom: 0.375rem;
}
.role-switcher__select {
  width: 100%;
}
.role-switcher__row {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.role-switcher__icon {
  font-size: 0.875rem;
  color: var(--bs-blue);
}
.role-switcher__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
