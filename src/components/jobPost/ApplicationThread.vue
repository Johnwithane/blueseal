<script setup lang="ts">
// Text-only realtime Q&A thread for a single job-board application, used before
// acceptance so the client and that one applicant can discuss the quote
// (negotiate price, timing, scope). Deliberately NOT ChatThread — that's coupled
// to the job `chats/` collection, photo upload, and AI replies. This is leaner:
// text only, application-scoped, with role-aware quick-prompt chips.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import Avatar from "primevue/avatar";
import {
  subscribeApplicationThread,
  sendApplicationMessage,
  markApplicationThreadRead,
} from "@/firebase/services/applications";
import type { ApplicationMessageDoc, WithId } from "@/firebase/interfaces";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  postId: string;
  applicationId: string;
  // Drives the quick-prompt chip set: the client asks, the tradie answers back.
  role: "client" | "tradesperson";
}>();

const auth = useAuthStore();
const toast = useToast();

const messages = ref<WithId<ApplicationMessageDoc>[]>([]);
const text = ref("");
const sending = ref(false);
const scroller = ref<HTMLElement | null>(null);
const composer = ref<InstanceType<typeof Textarea> | null>(null);
let unsub: (() => void) | null = null;

const myUid = computed(() => auth.fbUser?.uid ?? null);

// Qualitative prompts only — no fee figures / SLA promises (CLAUDE.md copy rule).
const CLIENT_PROMPTS = [
  "Are you flexible on the price?",
  "Could you start sooner?",
  "Anything we could remove to lower the total?",
  "Can you walk me through the timeline?",
];
const TRADIE_PROMPTS = [
  "Happy to talk through the quote.",
  "I could start earlier if that helps.",
  "I can adjust the scope if you'd like.",
];
const prompts = computed(() => (props.role === "client" ? CLIENT_PROMPTS : TRADIE_PROMPTS));

function subscribe(applicationId: string) {
  unsub?.();
  unsub = subscribeApplicationThread(props.postId, applicationId, (m) => {
    messages.value = m;
    // Clear our unread badge when a message from the other party lands.
    if (myUid.value && m.some((msg) => msg.senderId !== myUid.value && msg.senderId !== "system")) {
      markApplicationThreadRead(props.postId, applicationId).catch(() => {
        /* best-effort */
      });
    }
    nextTick(() => scroller.value?.scrollTo({ top: scroller.value.scrollHeight }));
  });
}

onMounted(() => subscribe(props.applicationId));
watch(
  () => props.applicationId,
  (next, prev) => {
    if (next !== prev) subscribe(next);
  },
);
onUnmounted(() => unsub?.());

function formatClock(ts: { toMillis?: () => number } | null | undefined): string {
  const ms = typeof ts?.toMillis === "function" ? ts.toMillis() : Date.now();
  return new Date(ms).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

function senderInitial(m: WithId<ApplicationMessageDoc>): string {
  return ((m.senderName ?? "?").trim().slice(0, 1) || "?").toUpperCase();
}

function kindOf(m: WithId<ApplicationMessageDoc>): "self" | "other" | "system" {
  if (m.type === "system") return "system";
  return m.senderId === myUid.value ? "self" : "other";
}

function applyPrompt(p: string) {
  text.value = p;
  void nextTick(() => {
    const el = (composer.value as unknown as { $el?: HTMLTextAreaElement } | null)?.$el;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });
}

async function submit() {
  const body = text.value.trim();
  if (!body || sending.value) return;
  sending.value = true;
  try {
    await sendApplicationMessage({
      postId: props.postId,
      applicationId: props.applicationId,
      text: body,
    });
    text.value = "";
  } catch (e) {
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    sending.value = false;
  }
}

// Enter sends, Shift+Enter newline; skip while an IME candidate is composing.
function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  void submit();
}
</script>

<template>
  <div class="bs-athread">
    <div ref="scroller" class="bs-athread__thread">
      <div v-if="!messages.length" class="bs-athread__empty">
        No messages yet. Ask a question about the quote — start, timing, or price.
      </div>

      <template v-for="m in messages" :key="m.id">
        <div v-if="kindOf(m) === 'system'" class="bs-athread__system-row">
          <div class="bs-athread__system">
            {{ m.text }}
            <span class="bs-athread__system-time">· {{ formatClock(m.createdAt) }}</span>
          </div>
        </div>

        <div
          v-else
          :class="['bs-athread__row', kindOf(m) === 'self' ? 'bs-athread__row--self' : 'bs-athread__row--other']"
        >
          <div class="bs-athread__avatar-slot">
            <Avatar
              v-if="m.senderPhotoURL"
              :image="m.senderPhotoURL"
              shape="circle"
              class="bs-athread__avatar"
            />
            <Avatar
              v-else
              :label="senderInitial(m)"
              shape="circle"
              class="bs-athread__avatar bs-athread__avatar--initial"
            />
          </div>
          <div class="bs-athread__body">
            <div
              :class="['bs-athread__bubble', kindOf(m) === 'self' ? 'bs-athread__bubble--self' : 'bs-athread__bubble--other']"
            >
              <div class="bs-athread__text">{{ m.text }}</div>
            </div>
            <div class="bs-athread__time">{{ formatClock(m.createdAt) }}</div>
          </div>
        </div>
      </template>
    </div>

    <div class="bs-athread__prompts">
      <button
        v-for="(p, i) in prompts"
        :key="i"
        type="button"
        class="bs-athread__prompt"
        @click="applyPrompt(p)"
      >
        {{ p }}
      </button>
    </div>

    <form class="bs-athread__composer" @submit.prevent="submit">
      <Textarea
        ref="composer"
        v-model="text"
        rows="1"
        auto-resize
        maxlength="2000"
        placeholder="Write a message…"
        class="flex-1"
        @keydown="onKeydown"
      />
      <Button icon="pi pi-send" type="submit" :loading="sending" :disabled="!text.trim()" />
    </form>
  </div>
</template>

<style scoped>
.bs-athread {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: white;
}

.bs-athread__thread {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  background: #f6f8fb;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.bs-athread__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 0.875rem;
  color: var(--bs-muted);
  padding: 2rem 1rem;
}

.bs-athread__system-row {
  display: flex;
  justify-content: center;
  margin: 0.5rem 0;
}
.bs-athread__system {
  font-size: 0.75rem;
  color: var(--bs-muted);
  background: rgba(15, 23, 42, 0.04);
  border-radius: 9999px;
  padding: 0.25rem 0.75rem;
  max-width: 85%;
  text-align: center;
}
.bs-athread__system-time {
  opacity: 0.6;
  margin-left: 0.25rem;
}

.bs-athread__row {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin-top: 0.6rem;
}
.bs-athread__row--self {
  flex-direction: row-reverse;
}
.bs-athread__avatar-slot {
  width: 1.65rem;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}
.bs-athread__avatar {
  width: 1.65rem !important;
  height: 1.65rem !important;
  font-size: 0.75rem !important;
}
.bs-athread__avatar--initial {
  background-color: var(--bs-blue) !important;
  color: white !important;
  font-weight: 600;
}
.bs-athread__body {
  min-width: 0;
  max-width: calc(100% - 2.5rem);
  display: flex;
  flex-direction: column;
}
.bs-athread__row--self .bs-athread__body {
  align-items: flex-end;
}
.bs-athread__time {
  font-size: 0.65rem;
  color: var(--bs-muted);
  margin: 0.2rem 0.35rem 0;
}
.bs-athread__row--self .bs-athread__time {
  text-align: right;
}

.bs-athread__bubble {
  border-radius: 1.1rem;
  padding: 0.6rem 0.9rem;
  font-size: 0.9rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.bs-athread__bubble--other {
  background: white;
  border: 1px solid var(--bs-border);
  border-bottom-left-radius: 0.45rem;
  color: var(--bs-text);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.bs-athread__bubble--self {
  background: linear-gradient(135deg, #59b0e0 0%, #3a8cc0 100%);
  color: white;
  border-bottom-right-radius: 0.45rem;
  box-shadow: 0 1px 2px rgba(29, 64, 106, 0.15);
}
.bs-athread__text {
  white-space: pre-wrap;
}

.bs-athread__prompts {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding: 0.6rem 0.75rem;
  border-top: 1px solid var(--bs-border);
  background: #f0f7fc;
}
.bs-athread__prompt {
  flex: 0 0 auto;
  font-size: 0.8rem;
  white-space: nowrap;
  border-radius: 9999px;
  border: 1px solid var(--bs-border);
  background: white;
  padding: 0.4rem 0.75rem;
  min-height: 36px;
  color: var(--bs-text);
  transition: border-color 0.15s, background-color 0.15s;
}
.bs-athread__prompt:hover {
  border-color: var(--bs-blue);
  background: rgba(89, 176, 224, 0.08);
}

.bs-athread__composer {
  border-top: 1px solid var(--bs-border);
  background: white;
  padding: 0.75rem;
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}
</style>
