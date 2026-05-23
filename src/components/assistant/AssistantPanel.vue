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

const subtitle = computed(() => {
  switch (store.scope) {
    case "job":
      return "Grounded in this job's chat, intake form, and photos.";
    case "admin":
      return "Knows which admin page you're on — ask about what you're viewing.";
    default:
      return "General help — for job-specific questions, open the job first.";
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
  <div class="bs-assistant-backdrop" aria-hidden="true" @click="close" />
  <aside
    class="bs-assistant-panel"
    role="dialog"
    aria-label="Assistant"
    aria-modal="false"
  >
    <header class="bs-assistant-panel__header">
      <img
        src="/icons/blueseal_logo.png"
        alt=""
        class="bs-assistant-panel__logo"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <h2 class="text-base font-semibold truncate">{{ store.threadTitle }}</h2>
        <p class="text-xs text-[color:var(--bs-muted)] truncate">{{ subtitle }}</p>
      </div>
      <div class="flex items-center gap-1 shrink-0">
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
.bs-assistant-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.3);
  z-index: 49;
}
.bs-assistant-panel {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  max-width: 100%;
  background: white;
  z-index: 50;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.15);
}
.bs-assistant-panel__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--bs-border);
  background: white;
}
.bs-assistant-panel__logo {
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
  border-radius: 9999px;
  background: white;
  border: 1px solid var(--bs-border);
  padding: 0.2rem;
  object-fit: contain;
}
@media (min-width: 640px) {
  .bs-assistant-panel {
    width: 420px;
    max-width: 92vw;
  }
  /* Desktop: keep the backdrop subtle (you can click outside to close) but
     don't fully dim the page since the panel is narrow. */
  .bs-assistant-backdrop {
    background: rgba(15, 23, 42, 0.08);
  }
}
</style>
