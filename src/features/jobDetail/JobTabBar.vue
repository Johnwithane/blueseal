<script setup lang="ts">
export interface JobTab {
  key: string;
  label: string;
  icon: string;
  badge?: "dot" | number;
}

defineProps<{
  tabs: JobTab[];
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [key: string];
}>();

function onClick(key: string) {
  emit("update:modelValue", key);
}
</script>

<template>
  <div class="job-tab-bar">
    <div class="bs-container">
      <div role="tablist" class="tab-row" aria-label="Job sections">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          role="tab"
          :aria-selected="modelValue === t.key"
          :aria-label="t.label"
          :tabindex="modelValue === t.key ? 0 : -1"
          class="tab"
          :class="{ 'tab--active': modelValue === t.key }"
          @click="onClick(t.key)"
        >
          <i :class="['pi', t.icon, 'icon']" aria-hidden="true"></i>
          <span class="label">{{ t.label }}</span>
          <span v-if="t.badge === 'dot'" class="badge-dot" aria-hidden="true"></span>
          <span v-else-if="typeof t.badge === 'number' && t.badge > 0" class="badge-count">
            {{ t.badge > 99 ? "99+" : t.badge }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.job-tab-bar {
  position: sticky;
  /* AppShell renders this route inside its content column with no top
     chrome above it on either viewport — the side panel sits to the left
     on desktop, and mobileCompact hides the bottom nav on mobile. So the
     tab bar can always stick to the top edge of the content column. */
  top: 0;
  z-index: 20;
  background: white;
  border-bottom: 1px solid var(--bs-border);
  margin-inline: -1rem;
  margin-bottom: 1rem;
}

.tab-row {
  display: flex;
  gap: 0;
  overflow-x: auto;
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.tab-row::-webkit-scrollbar {
  display: none;
}

.tab {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 0.5rem;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--bs-muted);
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: -0.01em;
  cursor: pointer;
  white-space: nowrap;
  transition: color 120ms ease, border-color 120ms ease;
  min-height: 44px;
}

.tab:hover {
  color: var(--bs-text);
}

.tab--active {
  color: var(--bs-blue);
  border-bottom-color: var(--bs-blue);
  font-weight: 600;
}

.tab:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: -2px;
}

.icon {
  font-size: 1.05rem;
  line-height: 1;
}

/* Mobile: icons only. Label hidden visually but kept in DOM via aria-label
   for screen readers (`aria-label` on the button itself). */
.label {
  display: none;
}

@media (min-width: 640px) {
  .label {
    display: inline;
  }
  .icon {
    font-size: 0.95rem;
  }
}

.badge-dot {
  position: absolute;
  top: 0.5rem;
  right: calc(50% - 1rem);
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 9999px;
  background: #ef4444;
}

.badge-count {
  position: absolute;
  top: 0.375rem;
  right: calc(50% - 1.25rem);
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.375rem;
  border-radius: 9999px;
  background: #ef4444;
  color: white;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.125rem;
  text-align: center;
}

@media (min-width: 640px) {
  /* On desktop the label takes space, so badges sit next to the icon
     inline instead of being absolutely positioned over a centred icon. */
  .badge-dot,
  .badge-count {
    position: static;
  }
  .badge-dot {
    width: 0.4rem;
    height: 0.4rem;
  }
}
</style>
