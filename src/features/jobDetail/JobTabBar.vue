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
</style>
