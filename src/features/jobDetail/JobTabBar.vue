<script setup lang="ts">
export interface JobTab {
  key: string;
  label: string;
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
          :tabindex="modelValue === t.key ? 0 : -1"
          class="tab"
          :class="{ 'tab--active': modelValue === t.key }"
          @click="onClick(t.key)"
        >
          <span class="label">{{ t.label }}</span>
          <span v-if="t.badge === 'dot'" class="badge-dot" aria-label="action required"></span>
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
  /* Sits flush under AppHeader (sticky top-0). 60px matches AppHeader's
     rendered height (py-3 + h-9 logo). If the header changes height,
     update this value. */
  top: 60px;
  z-index: 20;
  background: white;
  border-bottom: 1px solid var(--bs-border);
  margin-inline: -1rem; /* extend to viewport edges, matches bs-container padding */
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
  flex: 1 1 0;
  min-width: max-content;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.875rem 0.5rem;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--bs-muted);
  font-size: 0.8125rem;
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

.label {
  min-width: 0;
}

.badge-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 9999px;
  background: #ef4444;
  display: inline-block;
}

.badge-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.375rem;
  border-radius: 9999px;
  background: #ef4444;
  color: white;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1;
}

@media (min-width: 640px) {
  .tab {
    font-size: 0.875rem;
    padding: 0.875rem 1rem;
    gap: 0.5rem;
  }
}
</style>
