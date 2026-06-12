<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, nextTick, watch } from "vue";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import Avatar from "primevue/avatar";
import {
  subscribeMessages,
  sendMessage,
  markRead,
  isAllowedPhotoUrl,
} from "@/firebase/services/chats";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { suggestChatReplies } from "@/firebase/services/assistant";
import type { MessageDoc, WithId } from "@/firebase/interfaces";
import { useAuthStore } from "@/stores/auth";
import { useSubscriptionStore } from "@/stores/subscription";
import { compressToWebp } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import ImageLightbox from "@/components/ImageLightbox.vue";

const props = defineProps<{
  chatId: string;
  // Optional — when provided AND `enableAiReplies` is true, a "Suggest"
  // button appears next to the composer that asks the AI for 2–3 short
  // reply candidates based on recent chat. Tradie-only on the backend.
  jobId?: string;
  enableAiReplies?: boolean;
}>();

const auth = useAuthStore();
const subscription = useSubscriptionStore();
const toast = useToast();

const messages = ref<WithId<MessageDoc>[]>([]);
// Tapping a chat photo opens it in a lightbox (not a new tab).
const lightboxSrc = ref<string | null>(null);
const text = ref("");
const sending = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const composerTextarea = ref<InstanceType<typeof Textarea> | null>(null);
let unsub: (() => void) | null = null;

// AI-suggested reply state. Populated by clicking the Suggest button;
// cleared automatically when a new message lands (so the suggestions
// don't go stale against the chat they were generated for).
const suggestions = ref<string[]>([]);
const loadingSuggestions = ref(false);
const lastMessageId = computed(() =>
  messages.value.length ? messages.value[messages.value.length - 1].id : null,
);

const myUid = computed(() => auth.fbUser?.uid ?? null);

function subscribe(chatId: string) {
  unsub?.();
  unsub = subscribeMessages(chatId, (m) => {
    messages.value = m;
    if (auth.fbUser && m.some((msg) => msg.senderId !== auth.fbUser?.uid)) {
      markRead(chatId).catch((e) => console.warn("markRead failed", e));
    }
    nextTick(() => scroller.value?.scrollTo({ top: scroller.value.scrollHeight }));
  });
}

onMounted(() => subscribe(props.chatId));

watch(
  () => props.chatId,
  (next, prev) => {
    if (next === prev) return;
    subscribe(next);
  },
);

onUnmounted(() => unsub?.());

watch(lastMessageId, () => {
  if (suggestions.value.length) suggestions.value = [];
});

const canSuggest = computed(() => {
  if (!props.enableAiReplies || !props.jobId) return false;
  // AI reply suggestions are a Blue Seal Pro feature (admins always pass).
  const isAdmin = (auth.roles ?? []).includes("admin");
  if (!subscription.isPro && !isAdmin) return false;
  const last = messages.value[messages.value.length - 1];
  if (!last) return false;
  if (last.senderId === myUid.value) return false;
  return true;
});

async function fetchSuggestions() {
  if (!props.jobId || loadingSuggestions.value) return;
  loadingSuggestions.value = true;
  try {
    const res = await suggestChatReplies(props.jobId);
    suggestions.value = res.suggestions ?? [];
    if (!suggestions.value.length) {
      toast.info("No suggestions", "Try once the client has replied.");
    }
  } catch (err) {
    toast.error("Suggestions unavailable", humanizeError(err));
  } finally {
    loadingSuggestions.value = false;
  }
}

function applySuggestion(s: string) {
  text.value = s;
  suggestions.value = [];
  void nextTick(() => {
    const el = (composerTextarea.value as unknown as { $el?: HTMLTextAreaElement } | null)?.$el;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });
}

function dismissSuggestions() {
  suggestions.value = [];
}

// "2:34 PM" — matches AssistantThread's clock format. Date isn't shown
// because the panel rarely spans days in a single visit; the inbox preview
// elsewhere carries the date when it actually matters.
function formatClock(ts: { toMillis?: () => number } | null | undefined): string {
  const ms = typeof ts?.toMillis === "function" ? ts.toMillis() : Date.now();
  return new Date(ms).toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface DisplayMessage {
  id: string;
  raw: WithId<MessageDoc>;
  kind: "self" | "other" | "system";
  showHeader: boolean; // first of a run from this sender → show avatar + name
  showTime: boolean; // last of a run from this sender → show timestamp
}

// Break a run of messages from the same sender once the gap exceeds this.
// Same heuristic iMessage / WhatsApp use — beyond this, the next line is
// "a new thought", deserves its own header + timestamp.
const GROUP_GAP_MS = 5 * 60 * 1000;

function tsMs(ts: unknown): number {
  const t = ts as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === "function" ? t.toMillis() : 0;
}

function hasInfo(m: WithId<MessageDoc>): boolean {
  return !!(m.senderName || m.senderPhotoURL);
}

function sameGroup(a: DisplayMessage | undefined, b: DisplayMessage | undefined): boolean {
  if (!a || !b) return false;
  if (a.kind === "system" || b.kind === "system") return false;
  if (a.kind !== b.kind || a.raw.senderId !== b.raw.senderId) return false;
  return Math.abs(tsMs(b.raw.createdAt) - tsMs(a.raw.createdAt)) <= GROUP_GAP_MS;
}

// Group consecutive messages from the same sender (iMessage pattern). The
// header (avatar + name) sits on the first message in each group that
// actually has sender info — legacy messages (no senderName/senderPhotoURL)
// silently pass the header on to the next message in their group rather
// than rendering an empty avatar slot. The timestamp sits on the last
// message of the group, legacy or not.
const displayMessages = computed<DisplayMessage[]>(() => {
  const me = myUid.value;
  const raw = messages.value.map((m): DisplayMessage => ({
    id: m.id,
    raw: m,
    kind: m.type === "system" ? "system" : m.senderId === me ? "self" : "other",
    showHeader: false,
    showTime: false,
  }));

  // First pass: assign a group id to each message.
  let gid = 0;
  const groupIds: number[] = [];
  raw.forEach((m, i) => {
    if (!sameGroup(raw[i - 1], m)) gid++;
    groupIds.push(gid);
  });

  // Second pass: find the first message-with-info in each group. That's
  // where the header lands. Groups with zero info-bearing messages (all
  // legacy) get no header at all.
  const headerIndexByGroup = new Map<number, number>();
  raw.forEach((m, i) => {
    const g = groupIds[i];
    if (m.kind !== "system" && hasInfo(m.raw) && !headerIndexByGroup.has(g)) {
      headerIndexByGroup.set(g, i);
    }
  });

  return raw.map((m, i) => ({
    ...m,
    showHeader: m.kind === "system" ? false : headerIndexByGroup.get(groupIds[i]) === i,
    // System events always show their own time; otherwise only the tail
    // of each group does.
    showTime: m.kind === "system" || !sameGroup(m, raw[i + 1]),
  }));
});

function senderInitial(m: WithId<MessageDoc>): string {
  return ((m.senderName ?? "?").trim().slice(0, 1) || "?").toUpperCase();
}

async function submit() {
  if (!auth.fbUser || !text.value.trim() || sending.value) return;
  sending.value = true;
  try {
    await sendMessage({
      chatId: props.chatId,
      senderId: auth.fbUser.uid,
      senderName: auth.user?.displayName ?? auth.fbUser.displayName ?? null,
      senderPhotoURL: auth.user?.photoURL ?? auth.fbUser.photoURL ?? null,
      text: text.value.trim(),
    });
    text.value = "";
  } catch (err) {
    toast.error("Couldn't send", humanizeError(err));
  } finally {
    sending.value = false;
  }
}

// Enter sends, Shift+Enter inserts a newline. IME composition (long-press /
// Asian input methods) emits Enter to commit the candidate — skip in that
// case so we don't eat their selection.
function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  void submit();
}

async function uploadPhoto(e: Event) {
  if (!auth.fbUser) return;
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  try {
    const compressed = await compressToWebp(file);
    const path = makeStoragePath({
      scope: "chats",
      id: props.chatId,
      filename: compressed.name,
    });
    const url = await uploadFile(path, compressed);
    await sendMessage({
      chatId: props.chatId,
      senderId: auth.fbUser.uid,
      senderName: auth.user?.displayName ?? auth.fbUser.displayName ?? null,
      senderPhotoURL: auth.user?.photoURL ?? auth.fbUser.photoURL ?? null,
      text: "",
      photoUrl: url,
    });
  } catch (err) {
    toast.error("Photo upload failed", humanizeError(err));
  } finally {
    target.value = "";
  }
}
</script>

<template>
  <div class="bs-chat">
    <div ref="scroller" class="bs-chat__thread">
      <div v-if="!messages.length" class="bs-chat__empty">
        No messages yet — say hi.
      </div>

      <template v-for="m in displayMessages" :key="m.id">
        <!-- System message: centered pill. Status / schedule / clock events. -->
        <div v-if="m.kind === 'system'" class="bs-chat__system-row">
          <div class="bs-chat__system">
            {{ m.raw.text }}
            <span class="bs-chat__system-time">· {{ formatClock(m.raw.createdAt) }}</span>
          </div>
        </div>

        <!-- Regular message row. Avatar slot keeps grouped messages aligned
             with the lead of their run. -->
        <div
          v-else
          :class="[
            'bs-chat__row',
            m.kind === 'self' ? 'bs-chat__row--self' : 'bs-chat__row--other',
            { 'bs-chat__row--tight': !m.showHeader },
          ]"
        >
          <div class="bs-chat__avatar-slot">
            <template v-if="m.showHeader">
              <Avatar
                v-if="m.raw.senderPhotoURL && isAllowedPhotoUrl(m.raw.senderPhotoURL)"
                :image="m.raw.senderPhotoURL"
                shape="circle"
                class="bs-chat__avatar"
              />
              <Avatar
                v-else-if="m.raw.senderName"
                :label="senderInitial(m.raw)"
                shape="circle"
                class="bs-chat__avatar bs-chat__avatar--initial"
              />
              <!-- Legacy message (no senderName): leave the slot empty so
                   the bubble still aligns with newer messages above/below. -->
            </template>
          </div>

          <div class="bs-chat__body">
            <div v-if="m.showHeader && m.raw.senderName" class="bs-chat__name">
              {{ m.raw.senderName }}
            </div>
            <div
              :class="[
                'bs-chat__bubble',
                m.kind === 'self' ? 'bs-chat__bubble--self' : 'bs-chat__bubble--other',
              ]"
            >
              <template v-if="m.raw.photoUrl && isAllowedPhotoUrl(m.raw.photoUrl)">
                <button
                  type="button"
                  class="bs-chat__photo-link"
                  @click="lightboxSrc = m.raw.photoUrl ?? null"
                >
                  <img
                    :src="m.raw.photoUrl"
                    class="bs-chat__photo"
                    alt="Chat photo"
                    loading="lazy"
                  />
                </button>
              </template>
              <div v-if="m.raw.text" class="bs-chat__text">{{ m.raw.text }}</div>
            </div>
            <div v-if="m.showTime" class="bs-chat__time">{{ formatClock(m.raw.createdAt) }}</div>
          </div>
        </div>
      </template>
    </div>

    <!-- AI-suggested reply chips. Shows up above the composer after the
         tradesperson clicks Suggest. Each chip drops its text into the
         composer on click. Cleared automatically when a new message
         arrives (see the watch on lastMessageId). -->
    <div v-if="suggestions.length" class="bs-chat__suggestions">
      <div class="bs-chat__suggestions-header">
        <span class="bs-chat__suggestions-title">
          <i class="pi pi-sparkles" aria-hidden="true" />
          AI-suggested replies
        </span>
        <button
          type="button"
          class="bs-chat__suggestions-close"
          aria-label="Dismiss suggestions"
          @click="dismissSuggestions"
        >
          <i class="pi pi-times text-xs" />
        </button>
      </div>
      <button
        v-for="(s, i) in suggestions"
        :key="i"
        type="button"
        class="bs-chat__suggestion"
        @click="applySuggestion(s)"
      >
        {{ s }}
      </button>
    </div>

    <form class="bs-chat__composer" @submit.prevent="submit">
      <Textarea
        ref="composerTextarea"
        v-model="text"
        rows="1"
        auto-resize
        placeholder="Write a message…"
        class="flex-1"
        @keydown="onKeydown"
      />
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="uploadPhoto" />
      <Button
        v-if="enableAiReplies"
        icon="pi pi-sparkles"
        outlined
        type="button"
        :loading="loadingSuggestions"
        :disabled="!canSuggest || loadingSuggestions"
        :title="canSuggest ? 'Suggest a reply (AI)' : 'Wait for the client to reply'"
        aria-label="Suggest a reply"
        @click="fetchSuggestions"
      />
      <Button icon="pi pi-image" outlined type="button" @click="fileInput?.click()" />
      <Button icon="pi pi-send" type="submit" :loading="sending" :disabled="!text.trim()" />
    </form>

    <ImageLightbox :src="lightboxSrc" @close="lightboxSrc = null" />
  </div>
</template>

<style scoped>
.bs-chat {
  display: flex;
  flex-direction: column;
  height: 60vh;
  border: 1px solid var(--bs-border);
  border-radius: 0.75rem;
  background: white;
  overflow: hidden;
}

.bs-chat__thread {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem 1rem 1rem;
  background: #f6f8fb;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.bs-chat__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  color: var(--bs-muted);
  padding: 2rem 0;
}

/* -------- System events (status / schedule / clock) -------- */
.bs-chat__system-row {
  display: flex;
  justify-content: center;
  margin: 0.5rem 0;
}
.bs-chat__system {
  font-size: 0.75rem;
  color: var(--bs-muted);
  background: rgba(15, 23, 42, 0.04);
  border-radius: 9999px;
  padding: 0.25rem 0.75rem;
  max-width: 80%;
  text-align: center;
}
.bs-chat__system-time {
  opacity: 0.6;
  margin-left: 0.25rem;
}

/* -------- Message rows -------- */
.bs-chat__row {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin-top: 0.85rem;
}
.bs-chat__row--self {
  flex-direction: row-reverse;
}
/* Grouped (non-leading) messages snug up to their predecessor — same
   pattern iMessage uses to reduce visual noise in a back-and-forth. */
.bs-chat__row--tight {
  margin-top: 0.15rem;
}

.bs-chat__avatar-slot {
  width: 1.65rem;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}
.bs-chat__avatar {
  width: 1.65rem !important;
  height: 1.65rem !important;
  font-size: 0.75rem !important;
}
.bs-chat__avatar--initial {
  background-color: var(--bs-blue) !important;
  color: white !important;
  font-weight: 600;
}

.bs-chat__body {
  min-width: 0;
  max-width: calc(100% - 2.5rem);
  display: flex;
  flex-direction: column;
}
.bs-chat__row--self .bs-chat__body {
  align-items: flex-end;
}
.bs-chat__name {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--bs-muted);
  letter-spacing: 0.01em;
  margin: 0 0.35rem 0.25rem;
}
.bs-chat__time {
  font-size: 0.65rem;
  color: var(--bs-muted);
  margin: 0.2rem 0.35rem 0;
}
.bs-chat__row--self .bs-chat__time {
  text-align: right;
}

/* -------- Bubbles -------- */
.bs-chat__bubble {
  border-radius: 1.1rem;
  padding: 0.6rem 0.9rem;
  font-size: 0.9rem;
  line-height: 1.5;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.bs-chat__bubble--other {
  background: white;
  border: 1px solid var(--bs-border);
  border-bottom-left-radius: 0.45rem;
  color: var(--bs-text);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.bs-chat__bubble--self {
  background: linear-gradient(135deg, #59b0e0 0%, #3a8cc0 100%);
  color: white;
  border-bottom-right-radius: 0.45rem;
  box-shadow: 0 1px 2px rgba(29, 64, 106, 0.15);
}
.bs-chat__text {
  white-space: pre-wrap;
}
.bs-chat__photo-link {
  display: block;
  margin: -0.1rem -0.3rem;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  width: 100%;
}
.bs-chat__photo-link + .bs-chat__text {
  margin-top: 0.5rem;
}
.bs-chat__photo {
  display: block;
  max-height: 15rem;
  max-width: 100%;
  border-radius: 0.65rem;
}

/* -------- AI suggestion chips -------- */
.bs-chat__suggestions {
  border-top: 1px solid var(--bs-border);
  background: #f0f7fc;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.bs-chat__suggestions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--bs-muted);
}
.bs-chat__suggestions-title {
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.bs-chat__suggestions-close {
  color: var(--bs-muted);
}
.bs-chat__suggestions-close:hover {
  color: var(--bs-text);
}
.bs-chat__suggestion {
  text-align: left;
  font-size: 0.875rem;
  border-radius: 0.55rem;
  border: 1px solid var(--bs-border);
  background: white;
  padding: 0.55rem 0.75rem;
  transition: border-color 0.15s, background-color 0.15s;
}
.bs-chat__suggestion:hover {
  border-color: var(--bs-blue);
  background: rgba(89, 176, 224, 0.08);
}

/* -------- Composer -------- */
.bs-chat__composer {
  border-top: 1px solid var(--bs-border);
  background: white;
  padding: 0.75rem;
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}
</style>
