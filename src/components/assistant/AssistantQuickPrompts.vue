<script setup lang="ts">
import { computed } from "vue";
import { useAssistantStore } from "@/stores/assistant";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

/**
 * Quick-prompt chips for the three job-scoped AI tasks that used to be
 * standalone callables (aiDiagnose / aiQuote / aiSummarize, design.md §5.9).
 * Clicking a chip fires the request immediately and hides the templated
 * prompt from the thread — the tradesperson just sees the AI's reply, the
 * same one-click feel as the old buttons but with the result landing in a
 * thread they can follow up in.
 */

const store = useAssistantStore();
const toast = useToast();

const visible = computed(() => store.scope === "job");
// Disable while a turn is in flight — otherwise rapid double-tapping fires
// duplicate calls (Vertex bills each one).
const disabled = computed(() => store.sending);

// The prompts double as instructions to the model — they include the
// "don't take any actions" boundary so a Summarize click can't trip the
// tool-use path that other free-form messages can.
const PROMPTS = [
  {
    key: "diagnose",
    label: "Diagnose",
    icon: "pi pi-bolt",
    prompt:
      "Diagnose what's likely going on with this job. Give me three things, each as a numbered list: (1) the most likely causes, most likely first, (2) checks I should run on-site, and (3) parts or tools to bring. This is a read-only request — do not call any tools or change anything on the job.",
  },
  {
    key: "quote",
    label: "Quote",
    icon: "pi pi-dollar",
    prompt:
      "Draft a quote for this job as a bulleted list of line items — description, estimated qty or hours, and ballpark unit price in CAD. End with a one-line caveat that final pricing depends on on-site inspection. This is a read-only request — do not call any tools or change anything on the job.",
  },
  {
    key: "summary",
    label: "Summary",
    icon: "pi pi-file",
    prompt:
      "Summarise this job in one short paragraph (about 5 sentences) suitable for my records. This is a read-only request — do not call any tools or change anything on the job.",
  },
] as const;

async function runPrompt(text: string) {
  if (disabled.value) return;
  store.open();
  try {
    await store.send(text, { hidden: true });
  } catch (err) {
    toast.error("Couldn't reach the assistant", humanizeError(err));
  }
}
</script>

<template>
  <div v-if="visible" class="bs-ai-chips" role="toolbar" aria-label="Quick prompts">
    <button
      v-for="p in PROMPTS"
      :key="p.key"
      type="button"
      class="bs-ai-chip"
      :disabled="disabled"
      @click="runPrompt(p.prompt)"
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
.bs-ai-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.bs-ai-chip i {
  color: var(--bs-blue);
  font-size: 0.78rem;
}
</style>
