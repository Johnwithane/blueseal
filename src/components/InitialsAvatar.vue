<script setup lang="ts">
// Photo-or-initials avatar circle. Replaces ~10 hand-rolled copies that each
// inlined `(name ?? "?").charAt(0).toUpperCase()` inside a rounded-full div
// (often beside a `v-if="photoURL"` <img>), with drifting sizes and colours.
// Pass a photoUrl to render the photo; otherwise the uppercased first letter.
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    name: string | null | undefined;
    photoUrl?: string | null;
    // Diameter in px.
    size?: number;
    // "soft" = blue-light tint / blue-dark text; "solid" = blue fill / white.
    tone?: "soft" | "solid";
  }>(),
  { photoUrl: null, size: 36, tone: "soft" },
);

const initial = computed(
  () => (props.name ?? "?").trim().charAt(0).toUpperCase() || "?",
);

const toneClass = computed(() =>
  props.tone === "solid"
    ? "bg-[color:var(--bs-blue)] text-white"
    : "bg-[color:var(--bs-blue-light)] text-[color:var(--bs-blue-dark)]",
);

const dims = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.42)}px`,
}));
</script>

<template>
  <img
    v-if="photoUrl"
    :src="photoUrl"
    alt=""
    class="rounded-full object-cover shrink-0"
    :style="{ width: dims.width, height: dims.height }"
  />
  <div
    v-else
    class="rounded-full grid place-items-center font-semibold shrink-0"
    :class="toneClass"
    :style="dims"
    aria-hidden="true"
  >
    {{ initial }}
  </div>
</template>
