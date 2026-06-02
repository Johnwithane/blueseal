<script setup lang="ts">
// Shared loading indicator. The app had ~25 ad-hoc loaders — bare
// "Loading…" text in a .bs-empty dashed box, inline pi-spin spinners, and
// spinner-in-card variants (UI_UX_AUDIT.md R11). This standardizes them.
//   default  — centred spinner + label (replaces the .bs-empty loading boxes)
//   inline   — spinner + label on one line (for inside cards / tight spots)
withDefaults(
  defineProps<{
    label?: string;
    inline?: boolean;
  }>(),
  { label: "Loading…", inline: false },
);
</script>

<template>
  <div
    :class="inline ? 'bs-loading bs-loading--inline' : 'bs-loading'"
    role="status"
    aria-live="polite"
  >
    <i
      class="pi pi-spin pi-spinner"
      :class="inline ? '' : 'text-2xl'"
      aria-hidden="true"
    ></i>
    <span>{{ label }}</span>
  </div>
</template>
