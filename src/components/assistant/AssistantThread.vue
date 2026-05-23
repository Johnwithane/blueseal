<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { marked } from "marked";
import Avatar from "primevue/avatar";
import { useAssistantStore } from "@/stores/assistant";
import { useAuthStore } from "@/stores/auth";
import { useFormatters } from "@/composables/useFormatters";

const store = useAssistantStore();
const auth = useAuthStore();
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

interface DisplayMessage {
  key: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number; // ms, for the meta line
  pending?: boolean;
}

const userInitial = computed(() => {
  const name = auth.user?.displayName?.trim() || auth.user?.email?.trim() || "";
  return (name[0] ?? "?").toUpperCase();
});
const userName = computed(() => {
  return auth.user?.displayName?.trim() || auth.user?.email?.split("@")[0] || "You";
});
const userPhoto = computed(() => auth.user?.photoURL ?? null);

// Merge the persisted-from-Firestore messages with any in-flight optimistic
// user turn. Dedupe: if the optimistic content matches the most-recent real
// user message, drop the optimistic — that way the brief window between
// "Vertex replied" and "Firestore listener delivered" doesn't double-render.
const displayMessages = computed<DisplayMessage[]>(() => {
  const out: DisplayMessage[] = store.messages.map((m) => ({
    key: m.id,
    role: m.role,
    content: m.content,
    // Firestore Timestamps have .toMillis(); fall back gracefully for the
    // sub-second window where the listener hasn't fully resolved the field.
    createdAt:
      typeof (m.createdAt as { toMillis?: () => number } | undefined)?.toMillis === "function"
        ? (m.createdAt as { toMillis: () => number }).toMillis()
        : Date.now(),
    pending: false,
  }));
  const opt = store.optimisticUserMessage;
  if (opt) {
    const lastUser = [...out].reverse().find((m) => m.role === "user");
    const alreadyPersisted = lastUser?.content === opt.content;
    if (!alreadyPersisted) {
      out.push({
        key: `optimistic-${opt.createdAt}`,
        role: "user",
        content: opt.content,
        createdAt: opt.createdAt,
        pending: true,
      });
    }
  }
  return out;
});

const hasMessages = computed(() => displayMessages.value.length > 0);

// Auto-scroll to the latest turn on append. Watch length AND the sending
// flag so the thinking-dots animation also triggers a scroll into view.
watch(
  [() => displayMessages.value.length, () => store.sending],
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
      <img
        src="/icons/blueseal_logo.png"
        alt=""
        class="bs-assistant-thread__empty-logo"
        aria-hidden="true"
      />
      <p class="text-sm text-[color:var(--bs-muted)] max-w-xs">{{ emptyHint }}</p>
    </div>

    <div v-else class="bs-assistant-thread__list">
      <div
        v-for="m in displayMessages"
        :key="m.key"
        :class="[
          'bs-assistant-row',
          m.role === 'user' ? 'bs-assistant-row--user' : 'bs-assistant-row--assistant',
        ]"
      >
        <!-- Avatar: Blue Seal logo for the assistant, user photo or initial
             for the tradesperson/admin. Sticks to the bubble's edge so each
             message reads as "from X". -->
        <div class="bs-assistant-row__avatar">
          <template v-if="m.role === 'assistant'">
            <img
              src="/icons/blueseal_logo.png"
              alt="Blue Seal"
              class="bs-assistant-avatar bs-assistant-avatar--logo"
            />
          </template>
          <template v-else>
            <Avatar
              v-if="userPhoto"
              :image="userPhoto"
              size="normal"
              shape="circle"
              class="bs-assistant-avatar"
            />
            <Avatar
              v-else
              :label="userInitial"
              size="normal"
              shape="circle"
              class="bs-assistant-avatar"
              style="background-color: var(--bs-blue); color: white; font-weight: 600;"
            />
          </template>
        </div>

        <div class="bs-assistant-row__body">
          <div class="bs-assistant-row__name">
            {{ m.role === "assistant" ? "Blue Seal Assistant" : userName }}
          </div>
          <div
            :class="[
              'bs-assistant-bubble',
              m.role === 'user' ? 'bs-assistant-bubble--user' : 'bs-assistant-bubble--assistant',
              { 'bs-assistant-bubble--pending': m.pending },
            ]"
          >
            <div v-if="m.role === 'user'" class="whitespace-pre-wrap">{{ m.content }}</div>
            <!-- Assistant content is model-generated markdown — see
                 renderMarkdown() for the sanitization policy. -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-else class="bs-assistant-md" v-html="renderMarkdown(m.content)" />
          </div>
          <div class="bs-assistant-row__meta">
            <span v-if="m.pending" class="text-[color:var(--bs-muted)]">Sending…</span>
            <span v-else>{{ dateTime(new Date(m.createdAt)) }}</span>
          </div>
        </div>
      </div>

      <div v-if="store.sending" class="bs-assistant-row bs-assistant-row--assistant">
        <div class="bs-assistant-row__avatar">
          <img
            src="/icons/blueseal_logo.png"
            alt=""
            class="bs-assistant-avatar bs-assistant-avatar--logo"
          />
        </div>
        <div class="bs-assistant-row__body">
          <div class="bs-assistant-row__name">Blue Seal Assistant</div>
          <div class="bs-assistant-bubble bs-assistant-bubble--assistant bs-assistant-bubble--thinking">
            <span class="bs-assistant-dot" /><span class="bs-assistant-dot" /><span class="bs-assistant-dot" />
          </div>
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
  gap: 0.75rem;
}
.bs-assistant-thread__empty-logo {
  width: 3rem;
  height: auto;
  opacity: 0.9;
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

/* Row layout: avatar + body. Reversed for the user so their avatar sits on
   the right and the bubble aligns with the user side. */
.bs-assistant-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  max-width: 100%;
}
.bs-assistant-row--user {
  flex-direction: row-reverse;
}
.bs-assistant-row__avatar {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
}
.bs-assistant-avatar {
  width: 2rem !important;
  height: 2rem !important;
}
.bs-assistant-avatar--logo {
  border-radius: 9999px;
  background: white;
  border: 1px solid var(--bs-border);
  padding: 0.2rem;
  object-fit: contain;
}
.bs-assistant-row__body {
  min-width: 0;
  max-width: calc(100% - 2.5rem);
  display: flex;
  flex-direction: column;
}
.bs-assistant-row--user .bs-assistant-row__body {
  align-items: flex-end;
}
.bs-assistant-row__name {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--bs-muted);
  margin-bottom: 0.2rem;
  padding-inline: 0.25rem;
}
.bs-assistant-row__meta {
  font-size: 0.625rem;
  opacity: 0.75;
  margin-top: 0.2rem;
  padding-inline: 0.25rem;
}
.bs-assistant-row--user .bs-assistant-row__meta {
  text-align: right;
}

.bs-assistant-bubble {
  border-radius: 1rem;
  padding: 0.55rem 0.85rem;
  font-size: 0.875rem;
  line-height: 1.45;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.bs-assistant-bubble--user {
  background: var(--bs-blue);
  color: white;
  border-bottom-right-radius: 0.375rem;
}
.bs-assistant-bubble--assistant {
  background: white;
  border: 1px solid var(--bs-border);
  border-bottom-left-radius: 0.375rem;
}
.bs-assistant-bubble--pending {
  opacity: 0.65;
}

/* Assistant markdown body. */
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

.bs-assistant-bubble--thinking {
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
