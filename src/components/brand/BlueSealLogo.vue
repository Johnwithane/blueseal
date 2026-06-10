<script setup lang="ts">
/**
 * Full horizontal Blue Seal lockup — brandmark + "BlueSeal" wordmark.
 *
 * Composed from BlueSealSeal (the official brandmark) + BlueSealWordmark so the
 * lockup, the standalone mark, and the wordmark always stay in visual sync and
 * tint together. Colour comes from `currentColor`; size by setting a height on
 * the element. `tone` selects the brandmark treatment:
 *   - tone="on-light" → knockout mark, for LIGHT surfaces (ink colour)
 *   - tone="on-dark"  → line emblem, for DARK surfaces (light colour)
 *
 *   <BlueSealLogo tone="on-light" class="h-9" style="color: var(--bs-blue)" />
 *   <BlueSealLogo tone="on-dark"  class="h-9" style="color: var(--bs-beige)" />
 */
import BlueSealSeal from "./BlueSealSeal.vue";
import BlueSealWordmark from "./BlueSealWordmark.vue";

withDefaults(
  defineProps<{
    tone?: "on-light" | "on-dark";
    title?: string;
    decorative?: boolean;
  }>(),
  { tone: "on-light", title: "Blue Seal", decorative: false },
);
</script>

<template>
  <span
    class="bs-logo-lockup"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : title"
    :aria-hidden="decorative ? 'true' : undefined"
  >
    <BlueSealSeal :tone="tone" decorative class="bs-logo-lockup__mark" />
    <BlueSealWordmark decorative class="bs-logo-lockup__word" />
  </span>
</template>

<style scoped>
.bs-logo-lockup {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: inherit;
  line-height: 0;
}
/* Mark fills the lockup height; wordmark sits at cap height (~56%), centred. */
.bs-logo-lockup__mark {
  height: 100%;
  width: auto;
}
.bs-logo-lockup__word {
  height: 56%;
  width: auto;
}
</style>
