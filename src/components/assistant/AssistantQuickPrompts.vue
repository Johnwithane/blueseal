<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
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
// Only show on a fresh thread — once a conversation has started, the chips
// would just compete with whatever the tradie is mid-typing.
const showCompact = computed(() => store.messages.length === 0);

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
  <div v-if="visible" :class="['bs-assistant-quickprompts', { 'is-compact': !showCompact }]">
    <Button
      v-for="p in PROMPTS"
      :key="p.key"
      :label="p.label"
      :icon="p.icon"
      size="small"
      outlined
      severity="secondary"
      @click="applyPrompt(p.prompt)"
    />
  </div>
</template>

<style scoped>
.bs-assistant-quickprompts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.625rem 0.75rem;
  border-top: 1px solid var(--bs-border);
  background: white;
}
.bs-assistant-quickprompts.is-compact {
  /* Once a thread has started, dim + tighten so the chips feel like a
     toolbar rather than the primary affordance. */
  opacity: 0.85;
}
</style>
