<script setup lang="ts">
// Decorative Blue Seal mascot image with graceful degradation.
//
// Images live (flat) in public/characters/ named `seal-<name>.webp`, so a
// `name` of "trade-plumber" resolves to "/characters/seal-trade-plumber.webp".
// Three families by convention:
//   trade-<key>   one per trade key in src/data/trades.ts (data-driven)
//   pose-<name>   reusable expressions (wave, peek, celebrate, thinking, …)
//   scene-<name>  contextual vignettes (search, quote, support, …)
//
// If the requested PNG is missing it falls back to `fallback` (if given), and
// failing that renders NOTHING — never a broken-image icon. That's deliberate:
// the mascot art is being added incrementally, so a spot wired here stays clean
// until its image is dropped in. (Firebase's SPA rewrite returns index.html for
// a missing file, which an <img> can't decode → the same onError path fires.)
import { computed, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    /** Character id without the `seal-` prefix/extension, e.g. "pose-wave". */
    name: string;
    /** Tried if `name` is missing. Leave empty to just disappear. */
    fallback?: string;
    /** Alt text. Empty (default) marks it decorative (aria-hidden). */
    alt?: string;
    /** Load eagerly (above the fold). Defaults to lazy. */
    eager?: boolean;
  }>(),
  { fallback: "", alt: "", eager: false },
);

// Let class/style/etc. fall through to the <img> even though the root can be
// absent (v-if) when hidden — manual binding avoids the stray-attrs warning.
defineOptions({ inheritAttrs: false });

const toSrc = (name: string) => `/characters/seal-${name}.webp`;

const chain = computed(() => [props.name, props.fallback].filter(Boolean));
const index = ref(0);
const hidden = ref(false);

// Reuse across a v-for (same instance, new name) must reset the fallback state.
watch(
  () => props.name,
  () => {
    index.value = 0;
    hidden.value = false;
  },
);

const currentSrc = computed(() => toSrc(chain.value[index.value]));

function onError() {
  if (index.value < chain.value.length - 1) index.value += 1;
  else hidden.value = true;
}
</script>

<template>
  <img
    v-if="!hidden"
    v-bind="$attrs"
    :src="currentSrc"
    :alt="alt"
    :aria-hidden="alt ? undefined : 'true'"
    :loading="eager ? 'eager' : 'lazy'"
    decoding="async"
    draggable="false"
    @error="onError"
  />
</template>
