<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import ChatThread from "@/components/ChatThread.vue";
import AssistantThread from "@/components/assistant/AssistantThread.vue";
import AssistantQuickPrompts from "@/components/assistant/AssistantQuickPrompts.vue";
import AssistantComposer from "@/components/assistant/AssistantComposer.vue";
import { useAssistantStore } from "@/stores/assistant";
import { useAuthStore } from "@/stores/auth";
import { useNotificationsStore } from "@/stores/notifications";
import type { JobDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  job: WithId<JobDoc>;
  isTradie: boolean;
}>();

const visible = defineModel<boolean>("visible", { required: true });

const auth = useAuthStore();
const assistant = useAssistantStore();
const notifs = useNotificationsStore();

// Sub-tab inside the overlay. Clients only get Chat — AI is tradie-only
// (see AssistantBubble.vue's `visible` rule). Defaults to Chat so the
// human conversation is the first thing both roles see.
type Sub = "chat" | "ai";
const sub = ref<Sub>("chat");

const showAiTab = computed(() => props.isTradie);

function close() {
  visible.value = false;
}

function onSwitchSub(next: Sub) {
  sub.value = next;
  if (next === "ai") {
    void ensureAssistantContext();
  }
}

// AssistantBubble is hidden on JobDetail (the bubble would compete with this
// overlay), so its watcher doesn't run to set the assistant store's context.
// We set it here when the AI tab actually activates, so the assistant knows
// it's grounded in this job.
async function ensureAssistantContext() {
  await assistant.setContext({
    userId: auth.fbUser?.uid ?? null,
    scope: "job",
    jobId: props.job.id,
    pageRoute: `/jobs/${props.job.id}`,
  });
}

// Reset the sub-tab back to Chat each time the overlay re-opens — the user's
// mental default for opening this surface is "I want to read/send a message,"
// not "continue my AI conversation."
watch(visible, (v) => {
  if (v) sub.value = "chat";
});

// Tear down the assistant context when the overlay closes for the last
// time — keeps stale job-scoped threads from leaking into the next view.
onBeforeUnmount(() => {
  assistant.reset();
  notifs.setActiveChat(null);
});

// Tell the global notification-toast watcher to suppress `message_received`
// pops for THIS chat while the user is actively reading it. Only active
// when the chat sub-tab is the visible one — if the user flips to AI, the
// chat thread isn't on screen, so the toast is useful again.
watch(
  [visible, sub],
  ([v, s]) => {
    notifs.setActiveChat(v && s === "chat" ? props.job.chatId : null);
  },
  { immediate: true },
);

// Lock the page body scroll while the overlay is open so the chat owns the
// viewport. Restore on close. Effectful, so we use a watch.
watch(visible, (v) => {
  if (typeof document === "undefined") return;
  document.body.style.overflow = v ? "hidden" : "";
});
</script>

<template>
  <Teleport to="body">
    <Transition name="overlay">
      <div v-if="visible" class="job-chat-overlay" role="dialog" aria-modal="true" aria-label="Chat and AI">
        <div class="backdrop" @click="close" />

        <aside class="panel">
          <header class="panel-header">
            <div class="title-row">
              <h2 class="title">Messages</h2>
              <Button
                icon="pi pi-times"
                text
                rounded
                severity="secondary"
                aria-label="Close"
                @click="close"
              />
            </div>

            <div v-if="showAiTab" role="tablist" class="sub-tabs" aria-label="Chat or AI">
              <button
                type="button"
                role="tab"
                :aria-selected="sub === 'chat'"
                class="sub-tab"
                :class="{ 'sub-tab--active': sub === 'chat' }"
                @click="onSwitchSub('chat')"
              >
                <i class="pi pi-comments" aria-hidden="true"></i>
                <span>Chat</span>
              </button>
              <button
                type="button"
                role="tab"
                :aria-selected="sub === 'ai'"
                class="sub-tab"
                :class="{ 'sub-tab--active': sub === 'ai' }"
                @click="onSwitchSub('ai')"
              >
                <i class="pi pi-sparkles" aria-hidden="true"></i>
                <span>AI</span>
              </button>
            </div>
          </header>

          <div class="panel-body">
            <ChatThread
              v-if="sub === 'chat'"
              :chat-id="job.chatId"
              :job-id="job.id"
              :enable-ai-replies="isTradie"
              class="chat-fill"
            />
            <div v-else-if="sub === 'ai' && showAiTab" class="ai-fill">
              <AssistantThread class="flex-1 min-h-0" />
              <AssistantQuickPrompts />
              <AssistantComposer />
            </div>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.job-chat-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  justify-content: flex-end;
}

.backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.32);
  backdrop-filter: blur(2px);
}

.panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: white;
  width: 100%;
  max-width: 100%;
  height: 100%;
  box-shadow: -12px 0 32px rgba(15, 23, 42, 0.18);
}

@media (min-width: 640px) {
  .panel {
    max-width: 420px;
  }
}

.panel-header {
  border-bottom: 1px solid var(--bs-border);
  background: white;
  padding-top: env(safe-area-inset-top);
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 0.75rem 0.75rem 1rem;
}

.title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--bs-text);
}

.sub-tabs {
  display: flex;
  gap: 0;
  padding: 0 0.5rem;
  border-top: 1px solid var(--bs-border);
}

.sub-tab {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.75rem 0.5rem;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--bs-muted);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  min-height: 44px;
}

.sub-tab:hover {
  color: var(--bs-text);
}

.sub-tab--active {
  color: var(--bs-blue);
  border-bottom-color: var(--bs-blue);
  font-weight: 600;
}

.sub-tab:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: -2px;
}

.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: white;
  overflow: hidden;
}

/* ChatThread's default `.bs-chat { height: 60vh }` doesn't fit a full-screen
   overlay. Override via :deep so it fills the available panel body. */
.panel-body :deep(.bs-chat) {
  height: 100%;
  border: 0;
  border-radius: 0;
  flex: 1;
  min-height: 0;
}

.ai-fill {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Transition: slide in from right on desktop, slide up from bottom on
   mobile. Keep both fast — the overlay should feel immediate. */
.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 180ms ease;
}
.overlay-enter-active .panel,
.overlay-leave-active .panel {
  transition: transform 220ms ease;
}
.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}
.overlay-enter-from .panel,
.overlay-leave-to .panel {
  transform: translateX(100%);
}

@media (max-width: 639px) {
  .overlay-enter-from .panel,
  .overlay-leave-to .panel {
    transform: translateY(100%);
  }
}
</style>
