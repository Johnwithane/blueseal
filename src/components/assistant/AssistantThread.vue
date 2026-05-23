<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { marked } from "marked";
import Avatar from "primevue/avatar";
import { useAssistantStore } from "@/stores/assistant";
import { useAuthStore } from "@/stores/auth";

const store = useAssistantStore();
const auth = useAuthStore();

const scroller = ref<HTMLElement | null>(null);

// Assistant turns render as markdown. The model talks in bullets / numbered
// lists / **bold** by default; rendering as plain text loses structure. GFM
// defaults already escape `<` and `>` in non-code text — as defence in
// depth against a prompt-injected XSS payload we additionally strip a
// short list of script-y tags from the rendered HTML.
const DROP_TAGS = /<\/?(?:script|style|iframe|object|embed)[^>]*>/gi;
function renderMarkdown(text: string): string {
  const html = marked.parse(text, { gfm: true, breaks: true, async: false }) as string;
  return html.replace(DROP_TAGS, "");
}

interface DisplayMessage {
  key: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number; // ms
  pending?: boolean;
  showAvatar: boolean; // first message of a sender-group → show avatar + name
  showTime: boolean; // last message of a sender-group → show timestamp
}

// User identity for the right-hand bubbles.
const userInitial = computed(() => {
  const name = auth.user?.displayName?.trim() || auth.user?.email?.trim() || "";
  return (name[0] ?? "?").toUpperCase();
});
const userName = computed(
  () => auth.user?.displayName?.trim() || auth.user?.email?.split("@")[0] || "You",
);
const userPhoto = computed(() => auth.user?.photoURL ?? null);

function timestampMs(raw: unknown): number {
  const tsLike = raw as { toMillis?: () => number } | undefined;
  return typeof tsLike?.toMillis === "function" ? tsLike.toMillis() : Date.now();
}

function formatClock(ms: number): string {
  // "2:34 PM" style — same clock used by iMessage/WhatsApp for grouped
  // messages. No date here; the panel rarely spans days.
  return new Date(ms).toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  });
}

// Merge persisted + optimistic messages into one ordered list, then walk it
// to compute grouping flags (showAvatar = first of a run from this sender,
// showTime = last of a run). This is the iMessage pattern — repeated
// avatars + names + timestamps create huge visual noise on a 440px panel.
const displayMessages = computed<DisplayMessage[]>(() => {
  // Filter out quick-prompt messages — those are persisted so the model
  // has follow-up context, but the user clicked a chip and shouldn't see
  // the templated prompt come back at them.
  const visible = store.messages.filter(
    (m) => m.contextSnapshot?.source !== "quick-prompt",
  );
  const raw: Omit<DisplayMessage, "showAvatar" | "showTime">[] = visible.map((m) => ({
    key: m.id,
    role: m.role,
    content: m.content,
    createdAt: timestampMs(m.createdAt),
    pending: false,
  }));
  const opt = store.optimisticUserMessage;
  if (opt) {
    const lastUser = [...raw].reverse().find((m) => m.role === "user");
    if (!lastUser || lastUser.content !== opt.content) {
      raw.push({
        key: `optimistic-${opt.createdAt}`,
        role: "user",
        content: opt.content,
        createdAt: opt.createdAt,
        pending: true,
      });
    }
  }
  return raw.map((m, i) => {
    const prev = raw[i - 1];
    const next = raw[i + 1];
    return {
      ...m,
      showAvatar: !prev || prev.role !== m.role,
      showTime: !next || next.role !== m.role,
    };
  });
});

const hasMessages = computed(() => displayMessages.value.length > 0);

watch(
  [() => displayMessages.value.length, () => store.sending],
  () => {
    void nextTick(() => {
      scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: "smooth" });
    });
  },
);

const emptyHeadline = computed(() => {
  if (store.scope === "job") return "How can I help with this job?";
  if (store.scope === "admin") return "What's on your mind, admin?";
  return "How can I help today?";
});
const emptyHint = computed(() => {
  switch (store.scope) {
    case "job":
      return "I can see this job's intake, photos, and chat history. Try the quick prompts below or ask anything.";
    case "admin":
      return "I'm aware of the page you're viewing. Ask about flags, anomalies, or summaries.";
    default:
      return "Open a specific job for grounded help with diagnosis, quoting, or summaries.";
  }
});
</script>

<template>
  <div ref="scroller" class="bs-ai-thread">
    <!-- Empty state — Blue Seal AI identity. Big logo avatar, friendly
         headline, contextual hint. -->
    <div v-if="!hasMessages" class="bs-ai-thread__empty">
      <span class="bs-ai-avatar bs-ai-avatar--lg bs-ai-avatar--float" aria-hidden="true">
        <img src="/icons/blueseal_logo.png" alt="" />
      </span>
      <h3 class="bs-ai-thread__empty-title">{{ emptyHeadline }}</h3>
      <p class="bs-ai-thread__empty-hint">{{ emptyHint }}</p>
    </div>

    <div v-else class="bs-ai-thread__list">
      <div
        v-for="m in displayMessages"
        :key="m.key"
        :class="[
          'bs-ai-row',
          m.role === 'user' ? 'bs-ai-row--user' : 'bs-ai-row--assistant',
          { 'bs-ai-row--tight': !m.showAvatar },
        ]"
      >
        <!-- Avatar slot — placeholder div keeps grouped messages aligned
             with their group's lead message. -->
        <div class="bs-ai-row__avatar">
          <template v-if="m.showAvatar && m.role === 'assistant'">
            <span class="bs-ai-avatar bs-ai-avatar--sm" aria-hidden="true">
              <img src="/icons/blueseal_logo.png" alt="" />
            </span>
          </template>
          <template v-else-if="m.showAvatar && m.role === 'user'">
            <Avatar
              v-if="userPhoto"
              :image="userPhoto"
              shape="circle"
              class="bs-ai-row__user-avatar"
            />
            <Avatar
              v-else
              :label="userInitial"
              shape="circle"
              class="bs-ai-row__user-avatar bs-ai-row__user-avatar--initial"
            />
          </template>
        </div>

        <div class="bs-ai-row__body">
          <div v-if="m.showAvatar" class="bs-ai-row__name">
            {{ m.role === "assistant" ? "Blue Seal AI" : userName }}
          </div>
          <div
            :class="[
              'bs-ai-bubble',
              m.role === 'user' ? 'bs-ai-bubble--user' : 'bs-ai-bubble--assistant',
              { 'bs-ai-bubble--pending': m.pending },
            ]"
          >
            <!-- User: plain text, whitespace-preserved. -->
            <div v-if="m.role === 'user'" class="bs-ai-bubble__text">{{ m.content }}</div>
            <!-- Assistant: rendered markdown (sanitized — see renderMarkdown). -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-else class="bs-ai-bubble__md" v-html="renderMarkdown(m.content)" />
          </div>
          <div v-if="m.showTime" class="bs-ai-row__time">
            <template v-if="m.pending">Sending…</template>
            <template v-else>{{ formatClock(m.createdAt) }}</template>
          </div>
        </div>
      </div>

      <!-- Thinking placeholder while Vertex is replying. -->
      <div v-if="store.sending" class="bs-ai-row bs-ai-row--assistant">
        <div class="bs-ai-row__avatar">
          <span class="bs-ai-avatar bs-ai-avatar--sm" aria-hidden="true">
            <img src="/icons/blueseal_logo.png" alt="" />
          </span>
        </div>
        <div class="bs-ai-row__body">
          <div class="bs-ai-row__name">Blue Seal AI</div>
          <div class="bs-ai-bubble bs-ai-bubble--assistant bs-ai-bubble--thinking">
            <span class="bs-ai-dot" /><span class="bs-ai-dot" /><span class="bs-ai-dot" />
          </div>
        </div>
      </div>
    </div>

    <div v-if="store.error" class="bs-ai-thread__error">
      {{ store.error }}
    </div>
  </div>
</template>

<style scoped>
.bs-ai-thread {
  overflow-y: auto;
  padding: 1.25rem 1rem 1rem;
  background: #f6f8fb;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* -------- Empty state -------- */
.bs-ai-thread__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2.5rem 1.25rem;
  gap: 0.5rem;
}
.bs-ai-thread__empty-title {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0.4rem 0 0;
  color: var(--bs-text);
  letter-spacing: -0.01em;
}
.bs-ai-thread__empty-hint {
  font-size: 0.85rem;
  color: var(--bs-muted);
  max-width: 18rem;
  line-height: 1.5;
  margin: 0;
}
.bs-ai-avatar--float {
  animation: bs-ai-float 4s ease-in-out infinite;
}
@keyframes bs-ai-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

/* -------- Error -------- */
.bs-ai-thread__error {
  margin-top: 0.5rem;
  padding: 0.55rem 0.75rem;
  border-radius: 0.5rem;
  background: #fef2f2;
  color: #991b1b;
  font-size: 0.8125rem;
  border: 1px solid #fecaca;
}

/* -------- Message rows -------- */
.bs-ai-thread__list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.bs-ai-row {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin-top: 0.85rem;
}
.bs-ai-row--user {
  flex-direction: row-reverse;
}
/* Grouped (non-leading) messages snug up to their predecessor + skip the
   avatar/name to reduce visual noise — same pattern iMessage uses. */
.bs-ai-row--tight {
  margin-top: 0.15rem;
}

.bs-ai-row__avatar {
  width: 1.65rem;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}
.bs-ai-row__user-avatar {
  width: 1.65rem !important;
  height: 1.65rem !important;
  font-size: 0.75rem !important;
}
.bs-ai-row__user-avatar--initial {
  background-color: var(--bs-blue) !important;
  color: white !important;
  font-weight: 600;
}

.bs-ai-row__body {
  min-width: 0;
  max-width: calc(100% - 2.5rem);
  display: flex;
  flex-direction: column;
}
.bs-ai-row--user .bs-ai-row__body {
  align-items: flex-end;
}
.bs-ai-row__name {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--bs-muted);
  letter-spacing: 0.01em;
  margin: 0 0.35rem 0.25rem;
}
.bs-ai-row__time {
  font-size: 0.65rem;
  color: var(--bs-muted);
  margin: 0.2rem 0.35rem 0;
}
.bs-ai-row--user .bs-ai-row__time {
  text-align: right;
}

/* -------- Bubbles -------- */
.bs-ai-bubble {
  border-radius: 1.1rem;
  padding: 0.6rem 0.9rem;
  font-size: 0.9rem;
  line-height: 1.5;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.bs-ai-bubble--assistant {
  background: white;
  border: 1px solid var(--bs-border);
  border-bottom-left-radius: 0.45rem;
  color: var(--bs-text);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.bs-ai-bubble--user {
  background: linear-gradient(135deg, #59b0e0 0%, #3a8cc0 100%);
  color: white;
  border-bottom-right-radius: 0.45rem;
  box-shadow: 0 1px 2px rgba(29, 64, 106, 0.15);
}
.bs-ai-bubble--pending {
  opacity: 0.7;
}
.bs-ai-bubble__text {
  white-space: pre-wrap;
}

/* Assistant markdown — clean, generous spacing, no jarring code blocks. */
.bs-ai-bubble__md :deep(p) {
  margin: 0 0 0.55rem 0;
}
.bs-ai-bubble__md :deep(p:last-child) {
  margin-bottom: 0;
}
.bs-ai-bubble__md :deep(ul),
.bs-ai-bubble__md :deep(ol) {
  padding-left: 1.25rem;
  margin: 0 0 0.55rem 0;
}
.bs-ai-bubble__md :deep(ul:last-child),
.bs-ai-bubble__md :deep(ol:last-child) {
  margin-bottom: 0;
}
.bs-ai-bubble__md :deep(li) {
  margin-bottom: 0.2rem;
}
.bs-ai-bubble__md :deep(li:last-child) {
  margin-bottom: 0;
}
.bs-ai-bubble__md :deep(strong) {
  font-weight: 600;
}
.bs-ai-bubble__md :deep(em) {
  font-style: italic;
}
.bs-ai-bubble__md :deep(code) {
  background: rgba(15, 23, 42, 0.07);
  padding: 0.05rem 0.3rem;
  border-radius: 0.3rem;
  font-size: 0.85em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.bs-ai-bubble__md :deep(pre) {
  background: rgba(15, 23, 42, 0.06);
  padding: 0.6rem 0.8rem;
  border-radius: 0.55rem;
  overflow-x: auto;
  font-size: 0.8125rem;
  margin: 0 0 0.55rem 0;
}
.bs-ai-bubble__md :deep(pre code) {
  background: transparent;
  padding: 0;
}
.bs-ai-bubble__md :deep(a) {
  color: var(--bs-blue-dark);
  text-decoration: underline;
}
.bs-ai-bubble__md :deep(h1),
.bs-ai-bubble__md :deep(h2),
.bs-ai-bubble__md :deep(h3) {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0.35rem 0 0.25rem;
  letter-spacing: -0.01em;
}
.bs-ai-bubble__md :deep(blockquote) {
  border-left: 3px solid var(--bs-blue-light);
  padding-left: 0.65rem;
  margin: 0 0 0.55rem;
  color: var(--bs-muted);
}
.bs-ai-bubble__md :deep(hr) {
  border: 0;
  border-top: 1px solid var(--bs-border);
  margin: 0.55rem 0;
}

/* -------- Thinking dots -------- */
.bs-ai-bubble--thinking {
  display: inline-flex;
  gap: 0.3rem;
  padding: 0.85rem 1rem;
  align-items: center;
}
.bs-ai-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 9999px;
  background: var(--bs-muted);
  animation: bs-ai-dot 1.2s infinite ease-in-out;
}
.bs-ai-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.bs-ai-dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes bs-ai-dot {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}
</style>
