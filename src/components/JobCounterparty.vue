<script setup lang="ts">
import { computed } from "vue";
import Avatar from "primevue/avatar";

const props = withDefaults(
  defineProps<{
    name: string | null | undefined;
    photoUrl: string | null | undefined;
    // Drives the fallback label when name is missing on legacy jobs.
    role: "client" | "tradesperson";
    size?: "small" | "normal";
  }>(),
  { size: "normal" },
);

const fallbackLabel = computed(() =>
  props.role === "client" ? "Client" : "Tradesperson",
);

const displayName = computed(() => {
  const n = (props.name ?? "").trim();
  return n.length > 0 ? n : fallbackLabel.value;
});

const initial = computed(() => displayName.value.slice(0, 1).toUpperCase());

const avatarSize = computed(() => (props.size === "small" ? "normal" : "large"));
</script>

<template>
  <div class="flex items-center gap-2 min-w-0">
    <Avatar
      v-if="props.photoUrl"
      :image="props.photoUrl"
      :size="avatarSize"
      shape="circle"
    />
    <Avatar
      v-else
      :label="initial"
      :size="avatarSize"
      shape="circle"
      style="background-color: var(--bs-blue); color: white; font-weight: 600;"
    />
    <span
      class="truncate"
      :class="props.size === 'small' ? 'text-xs' : 'text-sm font-medium'"
    >
      {{ displayName }}
    </span>
  </div>
</template>
