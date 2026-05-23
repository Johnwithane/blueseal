<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import { useConfirm } from "primevue/useconfirm";
import { useAssistantStore } from "@/stores/assistant";
import AssistantThread from "@/components/assistant/AssistantThread.vue";
import AssistantComposer from "@/components/assistant/AssistantComposer.vue";
import AssistantQuickPrompts from "@/components/assistant/AssistantQuickPrompts.vue";

const store = useAssistantStore();
const confirm = useConfirm();

const headerTitle = computed(() => {
  // The current thread's title is shown as a small chip below the assistant
  // name — the panel's "name" is always "Blue Seal AI" so the user knows
  // who they're talking to regardless of which thread is loaded.
  return "Blue Seal AI";
});

const scopeChip = computed(() => {
  switch (store.scope) {
    case "job":
      return { label: store.threadTitle, hint: "Grounded in this job's chat + intake" };
    case "admin":
      return { label: "Admin", hint: "Aware of the page you're viewing" };
    default:
      return { label: "General", hint: "Open a job for job-specific help" };
  }
});

function close() {
  store.close();
}

function clearThread() {
  if (!store.currentConversationId) return;
  confirm.require({
    header: "Clear this thread?",
    message: "The conversation history will be deleted. This can't be undone.",
    acceptLabel: "Clear",
    rejectLabel: "Keep",
    acceptClass: "p-button-danger",
    accept: () => void store.deleteCurrentConversation(),
  });
}
</script>

<template>
  <div class="bs-ai-backdrop" aria-hidden="true" @click="close" />
  <aside
    class="bs-ai-panel"
    role="dialog"
    aria-label="Blue Seal AI assistant"
    aria-modal="false"
  >
    <header class="bs-ai-panel__header">
      <span class="bs-ai-avatar bs-ai-avatar--md" aria-hidden="true">
        <img src="/icons/blueseal_logo.png" alt="" />
      </span>
      <div class="bs-ai-panel__heading">
        <h2 class="bs-ai-panel__title">{{ headerTitle }}</h2>
        <div class="bs-ai-panel__scope">
          <span class="bs-ai-panel__scope-chip">{{ scopeChip.label }}</span>
          <span class="bs-ai-panel__scope-hint">{{ scopeChip.hint }}</span>
        </div>
      </div>
      <div class="bs-ai-panel__actions">
        <Button
          v-if="store.currentConversationId"
          icon="pi pi-trash"
          severity="secondary"
          text
          rounded
          aria-label="Clear thread"
          @click="clearThread"
        />
        <Button
          icon="pi pi-times"
          severity="secondary"
          text
          rounded
          aria-label="Close assistant"
          @click="close"
        />
      </div>
    </header>

    <AssistantThread class="flex-1 min-h-0" />
    <AssistantQuickPrompts />
    <AssistantComposer />
  </aside>
</template>

<style scoped>
.bs-ai-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.32);
  z-index: 49;
  backdrop-filter: blur(2px);
}
.bs-ai-panel {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  max-width: 100%;
  background: #ffffff;
  z-index: 50;
  display: flex;
  flex-direction: column;
  box-shadow: -12px 0 32px rgba(15, 23, 42, 0.18);
}
.bs-ai-panel__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--bs-border);
  background: white;
}
.bs-ai-panel__heading {
  flex: 1;
  min-width: 0;
}
.bs-ai-panel__title {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--bs-text);
  line-height: 1.2;
  margin: 0;
}
.bs-ai-panel__scope {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.2rem;
  min-width: 0;
}
.bs-ai-panel__scope-chip {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--bs-blue-dark);
  background: #e0f2fe;
  padding: 0.1rem 0.45rem;
  border-radius: 9999px;
  white-space: nowrap;
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bs-ai-panel__scope-hint {
  font-size: 0.7rem;
  color: var(--bs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.bs-ai-panel__actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

/* .bs-ai-avatar sizing lives in src/assets/main.css since it's shared
   across the bubble, header, thread, and empty state. */

@media (min-width: 640px) {
  .bs-ai-panel {
    width: 440px;
    max-width: 92vw;
  }
  .bs-ai-backdrop {
    background: rgba(15, 23, 42, 0.08);
    backdrop-filter: none;
  }
}
</style>
