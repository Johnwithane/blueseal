<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { marked } from "marked";
import { useAssistantStore } from "@/stores/assistant";
import { useFormatters } from "@/composables/useFormatters";

const store = useAssistantStore();
const { dateTime } = useFormatters();

const scroller = ref<HTMLElement | null>(null);

// Render assistant turns as markdown. The model talks in bullets / numbered
// lists / **bold** by default, so rendering as plain text loses structure.
// We disable raw-HTML passthrough by GFM defaults and additionally strip a
// few high-risk tags as defence in depth — the user is the only consumer of
// their own conversation so the blast radius is small, but a prompt-injection
// attack could still try to land XSS on the tradie viewing the reply.
const DROP_TAGS = /<\/?(?:script|style|iframe|object|embed)[^>]*>/gi;
function renderMarkdown(text: string): string {
  const html = marked.parse(text, { gfm: true, breaks: true, async: false }) as string;
  return html.replace(DROP_TAGS, "");
}

const hasMessages = computed(() => store.messages.length > 0);

// Auto-scroll to the latest turn on append. We watch length (not the array
// reference) because Firestore listeners may emit new arrays with the same
// length on metadata-only updates.
watch(
  () => store.messages.length,
  () => {
    void nextTick(() => {
      scroller.value?.scrollTo({ top: scroller.value.scrollHeight });
    });
  },
);

const emptyHint = computed(() => {
  switch (store.scope) {
    case "job":
      return "Ask about this job — diagnosis, quoting, what to bring, how to phrase something to the client.";
    case "admin":
      return "Ask about what's on the page — vetting flags, user history, anomalies in the data.";
    default:
      return "Ask anything. For job-specific questions, open the job first so I can see the details.";
  }
});
</script>

<template>
  <div ref="scroller" class="bs-assistant-thread">
    <div v-if="!hasMessages" class="bs-assistant-thread__empty">
      <i class="pi pi-sparkles text-2xl mb-2 opacity-60" aria-hidden="true" />
      <p class="text-sm text-[color:var(--bs-muted)] max-w-xs">{{ emptyHint }}</p>
    </div>

    <div v-else class="bs-assistant-thread__list">
      <div
        v-for="m in store.messages"
        :key="m.id"
        :class="[
          'bs-assistant-msg',
          m.role === 'user' ? 'bs-assistant-msg--user' : 'bs-assistant-msg--assistant',
        ]"
      >
        <div class="bs-assistant-msg__bubble">
          <!-- User content is the user's own typed text — plain-text render
               with whitespace preserved. -->
          <div v-if="m.role === 'user'" class="whitespace-pre-wrap">{{ m.content }}</div>
          <!-- Assistant content is model-generated markdown — see
               renderMarkdown() for the sanitization policy. -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-else class="bs-assistant-md" v-html="renderMarkdown(m.content)" />
          <div class="bs-assistant-msg__meta">{{ dateTime(m.createdAt) }}</div>
        </div>
      </div>

      <div v-if="store.sending" class="bs-assistant-msg bs-assistant-msg--assistant">
        <div class="bs-assistant-msg__bubble bs-assistant-msg__bubble--thinking">
          <span class="bs-assistant-dot" /><span class="bs-assistant-dot" /><span class="bs-assistant-dot" />
        </div>
      </div>
    </div>

    <div v-if="store.error" class="bs-assistant-thread__error">
      {{ store.error }}
    </div>
  </div>
</template>

<style scoped>
.bs-assistant-thread {
  overflow-y: auto;
  padding: 1rem;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.bs-assistant-thread__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem 1rem;
}
.bs-assistant-thread__list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.bs-assistant-thread__error {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: #fef2f2;
  color: #991b1b;
  font-size: 0.8125rem;
}

.bs-assistant-msg {
  display: flex;
}
.bs-assistant-msg--user {
  justify-content: flex-end;
}
.bs-assistant-msg--assistant {
  justify-content: flex-start;
}
.bs-assistant-msg__bubble {
  max-width: 88%;
  border-radius: 1rem;
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
  line-height: 1.45;
}
.bs-assistant-msg--user .bs-assistant-msg__bubble {
  background: var(--bs-blue);
  color: white;
  border-bottom-right-radius: 0.375rem;
}
.bs-assistant-msg--assistant .bs-assistant-msg__bubble {
  background: white;
  border: 1px solid var(--bs-border);
  border-bottom-left-radius: 0.375rem;
}
.bs-assistant-msg__meta {
  font-size: 0.625rem;
  opacity: 0.65;
  margin-top: 0.25rem;
  text-align: right;
}

/* Assistant markdown body — match LegalDocument's tone but tighter. */
.bs-assistant-md :deep(p) {
  margin: 0 0 0.5rem 0;
}
.bs-assistant-md :deep(p:last-child) {
  margin-bottom: 0;
}
.bs-assistant-md :deep(ul),
.bs-assistant-md :deep(ol) {
  padding-left: 1.25rem;
  margin: 0 0 0.5rem 0;
}
.bs-assistant-md :deep(li) {
  margin-bottom: 0.125rem;
}
.bs-assistant-md :deep(strong) {
  font-weight: 600;
}
.bs-assistant-md :deep(code) {
  background: rgba(0, 0, 0, 0.06);
  padding: 0.05rem 0.25rem;
  border-radius: 0.25rem;
  font-size: 0.85em;
}
.bs-assistant-md :deep(pre) {
  background: rgba(0, 0, 0, 0.05);
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  font-size: 0.8125rem;
}
.bs-assistant-md :deep(a) {
  color: var(--bs-blue-dark);
  text-decoration: underline;
}

.bs-assistant-msg__bubble--thinking {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.75rem 0.9rem;
}
.bs-assistant-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 9999px;
  background: var(--bs-muted);
  animation: bs-assistant-dot 1.1s infinite ease-in-out;
}
.bs-assistant-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.bs-assistant-dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes bs-assistant-dot {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}
</style>
