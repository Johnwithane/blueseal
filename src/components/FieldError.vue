<script setup lang="ts">
// Per-field validation error, rendered directly beneath the input it belongs
// to. Pair with a `data-field="<key>"` wrapper around the input so
// useFormErrors().focusFirst() can scroll to and focus it.
defineProps<{ message?: string }>();
</script>

<template>
  <p
    v-if="message"
    class="mt-1 flex items-start gap-1 text-xs text-[color:var(--bs-danger)]"
  >
    <i class="pi pi-exclamation-circle mt-px text-[10px]"></i>
    <span>{{ message }}</span>
  </p>
</template>
