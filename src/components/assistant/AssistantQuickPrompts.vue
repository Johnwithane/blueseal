<script setup lang="ts">
import { computed } from "vue";
import { useAssistantStore } from "@/stores/assistant";

/**
 * Quick-prompt chips for the three job-scoped AI tasks that used to be
 * standalone callables (aiDiagnose / aiQuote / aiSummarize, design.md §5.9).
 * Clicking a chip pre-fills the composer so the tradesperson can review or
 * tweak before sending — single-keystroke send if they're happy with the
 * default. We don't auto-send because the old one-shot tools used to
 * surface results in a modal; here the same prompt becomes part of an
 * ongoing thread the tradie can follow up in.
 */

const store = useAssistantStore();

const visible = computed(() => store.scope === "job");

const PROMPTS = [
  {
    key: "diagnose",
    label: "Diagnose",
    icon: "pi pi-bolt",
    prompt:
      "Help me diagnose what's likely going on with this job. Give me three things, each as a numbered list: (1) the most likely causes, most likely first, (2) checks I should run on-site, and (3) parts or tools to bring.",
  },
  {
    key: "quote",
    label: "Quote",
    icon: "pi pi-dollar",
    prompt:
      "Draft a quote for this job as a bulleted list of line items — description, estimated qty or hours, and ballpark unit price in CAD. End with a one-line caveat that final pricing depends on on-site inspection.",
  },
  {
    key: "summary",
    label: "Summary",
    icon: "pi pi-file",
    prompt:
      "Summarise this job in one short paragraph (about 5 sentences) suitable for my records.",
  },
] as const;

function applyPrompt(text: string) {
  store.applyQuickPrompt(text);
}
</script>

<template>
  <div v-if="visible" class="bs-ai-chips" role="toolbar" aria-label="Quick prompts">
    <button
      v-for="p in PROMPTS"
      :key="p.key"
      type="button"
      class="bs-ai-chip"
      @click="applyPrompt(p.prompt)"
    >
      <i :class="p.icon" aria-hidden="true" />
      <span>{{ p.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.bs-ai-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.55rem 0.85rem;
  border-top: 1px solid var(--bs-border);
  background: white;
}
.bs-ai-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.7rem;
  border-radius: 9999px;
  border: 1px solid var(--bs-border);
  background: white;
  color: var(--bs-text);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
}
.bs-ai-chip:hover {
  background: #f0f7fc;
  border-color: var(--bs-blue-light);
}
.bs-ai-chip:active {
  transform: scale(0.98);
}
.bs-ai-chip:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: 2px;
}
.bs-ai-chip i {
  color: var(--bs-blue);
  font-size: 0.78rem;
}
</style>
