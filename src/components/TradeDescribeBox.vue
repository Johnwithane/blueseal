<script setup lang="ts">
// "Describe what you need" → instant trade suggestions.
//
// A plain-English entry box that maps a symptom or a room ("my sink is
// leaking", "bathroom") to tappable trade suggestions, so a client who doesn't
// know the trade name doesn't have to scroll a 60-item dropdown. Pure local
// keyword matching (src/data/tradeKeywords.ts) — deterministic, offline, zero
// cost, nothing exposed publicly.
//
// The parent owns what a tap *does*: Search runs a search; Post-a-job pre-fills
// the form. This component just surfaces suggestions and emits `select`.
import { computed } from "vue";
import InputText from "primevue/inputtext";
import { suggestTrades, type TradeSuggestion } from "@/data/tradeKeywords";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label?: string;
    placeholder?: string;
    examples?: string[];
    /** Highlight the suggestion matching this trade key (the active filter). */
    activeKey?: string | null;
    /** Input id — keep unique per page; drives the <label for>. */
    inputId?: string;
    noMatchHint?: string;
    /** Optional trade key → count of pros nearby, to annotate suggestions. */
    counts?: Record<string, number> | null;
  }>(),
  {
    label: "What do you need done?",
    placeholder: "Describe it in your own words…",
    examples: () => ["My sink is leaking", "Power keeps tripping", "Bathroom reno", "Furnace won't heat"],
    activeKey: null,
    inputId: "describe",
    noMatchHint: "No trade matched that yet — try different words or pick one below.",
    counts: null,
  },
);

const emit = defineEmits<{
  "update:modelValue": [string];
  select: [TradeSuggestion];
}>();

const text = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const suggestions = computed(() => suggestTrades(props.modelValue));
</script>

<template>
  <div>
    <label :for="inputId" class="text-xs font-medium">{{ label }}</label>
    <div class="bs-describe mt-1">
      <i class="pi pi-search" aria-hidden="true"></i>
      <InputText
        :id="inputId"
        v-model="text"
        :placeholder="placeholder"
        class="flex-1 border-0 bg-transparent shadow-none focus:shadow-none"
        autocomplete="off"
      />
      <button
        v-if="text"
        type="button"
        class="bs-describe-clear"
        aria-label="Clear"
        @click="text = ''"
      >
        <i class="pi pi-times" aria-hidden="true"></i>
      </button>
    </div>

    <!-- Empty state: example prompts that teach the box. -->
    <div v-if="!text.trim()" class="mt-2 flex flex-wrap items-center gap-1.5">
      <span class="text-xs text-[color:var(--bs-muted)]">Try:</span>
      <button
        v-for="ex in examples"
        :key="ex"
        type="button"
        class="bs-chip"
        @click="text = ex"
      >
        {{ ex }}
      </button>
    </div>

    <!-- Live suggestions as they type. -->
    <div v-else-if="suggestions.length" class="mt-2">
      <span class="text-xs text-[color:var(--bs-muted)]">Sounds like you need:</span>
      <div class="mt-1.5 flex flex-wrap gap-2">
        <button
          v-for="s in suggestions"
          :key="s.key"
          type="button"
          class="bs-suggestion"
          :class="{ 'bs-suggestion--active': activeKey === s.key }"
          :title="`Matched: ${s.matched.join(', ')}`"
          @click="emit('select', s)"
        >
          <i :class="s.icon" aria-hidden="true"></i>
          <span>{{ s.label }}</span>
          <span v-if="counts && counts[s.key] > 0" class="bs-suggestion-count">
            · {{ counts[s.key] }} nearby
          </span>
        </button>
      </div>
    </div>

    <!-- Typed something, nothing matched. -->
    <p v-else class="mt-2 text-xs text-[color:var(--bs-muted)]">
      {{ noMatchHint }}
    </p>
  </div>
</template>

<style scoped>
/* "Describe what you need" input — a borderless InputText inside a bordered
   shell with a leading search icon, so it reads as the primary, modern entry. */
.bs-describe {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.125rem 0.625rem;
  border: 1px solid var(--bs-border);
  border-radius: 8px;
  background: #fff;
  transition: border-color 120ms ease;
}
.bs-describe:focus-within {
  border-color: var(--bs-blue);
}
.bs-describe > .pi-search {
  color: var(--bs-blue);
}
.bs-describe-clear {
  display: flex;
  padding: 0.25rem;
  color: var(--bs-muted);
  border-radius: 999px;
}
.bs-describe-clear:hover {
  background: var(--bs-surface, #f1f5f9);
}

/* Example prompt chips (empty state). */
.bs-chip {
  padding: 0.25rem 0.625rem;
  font-size: 0.8125rem;
  border: 1px solid var(--bs-border);
  border-radius: 999px;
  background: #fff;
  color: var(--bs-text, inherit);
  transition: border-color 120ms ease, background 120ms ease;
}
.bs-chip:hover {
  border-color: var(--bs-blue);
}

/* Suggested-trade chips (live results). */
.bs-suggestion {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 600;
  border: 1px solid var(--bs-blue);
  border-radius: 999px;
  background: #fff;
  color: var(--bs-blue);
  transition: background 120ms ease, color 120ms ease;
}
.bs-suggestion:hover,
.bs-suggestion--active {
  background: var(--bs-blue);
  color: #fff;
}
/* "· N nearby" count — lighter weight; inherits colour so it flips on hover. */
.bs-suggestion-count {
  font-weight: 500;
  opacity: 0.75;
}
</style>
