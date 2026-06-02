<script setup lang="ts">
import TabBar, { type TabItem } from "@/components/TabBar.vue";

// Re-exported for existing importers (JobDetailView). JobTab is just a TabItem.
export type JobTab = TabItem;

defineProps<{
  tabs: JobTab[];
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [key: string];
}>();
</script>

<template>
  <div class="job-tab-bar">
    <div class="bs-container">
      <TabBar
        :tabs="tabs"
        :model-value="modelValue"
        aria-label="Job sections"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.job-tab-bar {
  position: sticky;
  /* Docks directly beneath JobDetailView's sticky Back bar — its `top` offset
     equals that bar's height (--job-topbar-h, set on the job-detail section).
     Falls back to 0 if the var isn't provided. */
  top: var(--job-topbar-h, 0);
  z-index: 20;
  background: white;
  border-bottom: 1px solid var(--bs-border);
  margin-inline: -1rem;
  margin-bottom: 1rem;
}
</style>
