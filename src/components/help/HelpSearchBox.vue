<script setup lang="ts">
// Instant Help Center search. Type-ahead results with highlighted matches and
// full keyboard nav (↑/↓ to move, Enter to open, Esc to clear). Search runs
// client-side over the cached Help index — no backend, no per-query cost.
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useHelpContent } from "@/composables/useHelpContent";
import type { HelpSearchResult } from "@/utils/helpSearch";

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    autofocus?: boolean;
    /** Larger hero styling for the Help Center landing. */
    size?: "default" | "hero";
  }>(),
  { placeholder: "Search help articles…", autofocus: false, size: "default" },
);

const router = useRouter();
const { search } = useHelpContent();

const query = ref("");
const open = ref(false);
const active = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);

const results = computed<HelpSearchResult[]>(() =>
  query.value.trim() ? search(query.value, 8) : [],
);

watch(query, () => {
  active.value = 0;
  open.value = query.value.trim().length > 0;
});

function targetFor(r: HelpSearchResult) {
  return r.item.kind === "article"
    ? { name: "HelpArticle", params: { slug: r.item.ref } }
    : { name: "Faq", query: { q: r.item.title } };
}

function go(r: HelpSearchResult) {
  open.value = false;
  query.value = "";
  router.push(targetFor(r));
}

function onEnter() {
  const list = results.value;
  if (list.length === 0) {
    if (query.value.trim()) router.push({ name: "HelpCenter", query: { q: query.value.trim() } });
    return;
  }
  go(list[Math.min(active.value, list.length - 1)]);
}

function move(delta: number) {
  const n = results.value.length;
  if (n === 0) return;
  active.value = (active.value + delta + n) % n;
}

function onBlur() {
  // Delay so a click on a result registers before the panel closes.
  window.setTimeout(() => (open.value = false), 120);
}

if (props.autofocus) {
  nextTick(() => inputEl.value?.focus());
}
</script>

<template>
  <div class="relative" :class="size === 'hero' ? 'max-w-2xl' : ''">
    <div class="relative">
      <i
        class="pi pi-search pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--bs-muted)]"
        :class="size === 'hero' ? 'text-lg' : ''"
      ></i>
      <input
        ref="inputEl"
        v-model="query"
        type="search"
        :placeholder="placeholder"
        class="w-full rounded-full border border-[color:var(--bs-border)] bg-white pl-11 pr-4 text-[color:var(--bs-text)] shadow-sm outline-none transition-shadow focus:border-[color:var(--bs-blue)] focus:ring-2 focus:ring-[color:var(--bs-blue-light)]"
        :class="size === 'hero' ? 'py-4 text-lg' : 'py-2.5'"
        role="combobox"
        :aria-expanded="open"
        aria-controls="help-search-results"
        aria-label="Search help articles"
        @focus="open = query.trim().length > 0"
        @blur="onBlur"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="onEnter"
        @keydown.esc.prevent="query = ''"
      />
    </div>

    <!-- Results dropdown -->
    <div
      v-if="open"
      id="help-search-results"
      class="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-[color:var(--bs-border)] bg-white text-left shadow-xl"
    >
      <ul v-if="results.length" class="max-h-[60vh] overflow-y-auto py-1">
        <li v-for="(r, i) in results" :key="r.item.ref">
          <button
            type="button"
            class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors"
            :class="i === active ? 'bg-[color:var(--bs-surface-alt)]' : 'hover:bg-[color:var(--bs-surface-alt)]'"
            @mouseenter="active = i"
            @mousedown.prevent="go(r)"
          >
            <i
              :class="[
                r.item.kind === 'article' ? 'pi pi-file' : 'pi pi-question-circle',
                'mt-0.5 text-[color:var(--bs-blue)]',
              ]"
            ></i>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-[color:var(--bs-blue-dark)]">
                <template v-for="(seg, si) in r.titleSegments" :key="si"
                  ><mark v-if="seg.hit" class="bg-[color:var(--bs-blue-light)]/60 text-inherit">{{ seg.text }}</mark
                  ><template v-else>{{ seg.text }}</template></template
                >
              </span>
              <span class="mt-0.5 block truncate text-xs text-[color:var(--bs-muted)]">
                {{ r.item.subtitle }}
              </span>
            </span>
            <span class="bs-pill shrink-0 text-[10px]">{{
              r.item.kind === "article" ? "Article" : "FAQ"
            }}</span>
          </button>
        </li>
      </ul>
      <div v-else class="px-4 py-6 text-center text-sm text-[color:var(--bs-muted)]">
        No results for "{{ query }}". Try different words, or
        <RouterLink :to="{ name: 'HelpCenter' }" class="font-medium">browse all topics</RouterLink>.
      </div>
    </div>
  </div>
</template>
