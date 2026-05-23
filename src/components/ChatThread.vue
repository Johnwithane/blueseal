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
import { useFormatters } from "@/composables/useFormatters";
import { compressToWebp } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  chatId: string;
  // Optional — when provided AND `enableAiReplies` is true, a "Suggest"
  // button appears next to the composer that asks the AI for 2–3 short
  // reply candidates based on recent chat. Tradie-only on the backend.
  jobId?: string;
  enableAiReplies?: boolean;
}>();

const auth = useAuthStore();
const { dateTime } = useFormatters();
const toast = useToast();

const messages = ref<WithId<MessageDoc>[]>([]);
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

// Suggestions are tied to a specific moment in the conversation. As soon
// as a new message lands, dismiss them — otherwise the tradie could send
// a reply that no longer matches what's on screen.
watch(lastMessageId, () => {
  if (suggestions.value.length) suggestions.value = [];
});

// Show the Suggest button only when AI is enabled, we have a jobId, and
// the most recent message is NOT mine (suggesting a reply to your own
// message is silly). Also hide if no messages yet — nothing to reply to.
const canSuggest = computed(() => {
  if (!props.enableAiReplies || !props.jobId) return false;
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

function senderInitial(m: WithId<MessageDoc>): string {
  return ((m.senderName ?? "?").trim().slice(0, 1) || "?").toUpperCase();
}

function isMine(m: WithId<MessageDoc>): boolean {
  return m.senderId === myUid.value;
}

function isSystem(m: WithId<MessageDoc>): boolean {
  return m.type === "system";
}

// Legacy messages (sent before senderName/senderPhotoURL were added) have
// neither field. Treat them as anonymous so we don't render a useless "?"
// avatar — the bubble alone is the same UX the user had before.
function hasSenderInfo(m: WithId<MessageDoc>): boolean {
  return !!(m.senderName || m.senderPhotoURL);
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

// Enter sends, Shift+Enter inserts a newline. PrimeVue's Textarea is a
// vanilla <textarea> under the hood, so keydown bubbles up here as usual.
// IME composition (long-press / Asian input methods) emits Enter to commit
// the candidate — we skip in that case to avoid eating their selection.
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
  <div class="flex flex-col h-[60vh] bs-card overflow-hidden">
    <div ref="scroller" class="flex-1 overflow-y-auto p-4 space-y-3 bg-[#f9fafb]">
      <div v-if="!messages.length" class="text-center text-sm text-[color:var(--bs-muted)] py-8">
        No messages yet — say hi.
      </div>
      <template v-for="m in messages" :key="m.id">
        <!-- System message: centered, no avatar, no bubble. Used for
             status / schedule / clock automated events. -->
        <div v-if="isSystem(m)" class="flex justify-center">
          <div
            class="text-xs text-[color:var(--bs-muted)] bg-[color:var(--bs-border)]/40 rounded-full px-3 py-1 max-w-[80%] text-center"
          >
            {{ m.text }}
            <span class="opacity-60 ml-1">· {{ dateTime(m.createdAt) }}</span>
          </div>
        </div>

        <!-- Regular message with avatar + name. Avatar sits on the opposite
             side from the bubble so own messages stay right-aligned. Legacy
             messages (no senderName / senderPhotoURL) render without an
             avatar so they keep the pre-denormalization look. -->
        <div
          v-else
          :class="['flex items-end gap-2', isMine(m) ? 'justify-end' : 'justify-start']"
        >
          <template v-if="!isMine(m) && hasSenderInfo(m)">
            <Avatar
              v-if="m.senderPhotoURL && isAllowedPhotoUrl(m.senderPhotoURL)"
              :image="m.senderPhotoURL"
              shape="circle"
              size="normal"
            />
            <Avatar
              v-else
              :label="senderInitial(m)"
              shape="circle"
              size="normal"
              style="background-color: var(--bs-blue); color: white; font-weight: 600;"
            />
          </template>
          <div
            :class="[
              'max-w-[75%] rounded-2xl px-3 py-2 text-sm',
              isMine(m)
                ? 'bg-[color:var(--bs-blue)] text-white'
                : 'bg-white border border-[color:var(--bs-border)]',
            ]"
          >
            <div
              v-if="!isMine(m) && m.senderName"
              class="text-[11px] font-semibold opacity-80 mb-0.5"
            >
              {{ m.senderName }}
            </div>
            <template v-if="m.photoUrl && isAllowedPhotoUrl(m.photoUrl)">
              <a :href="m.photoUrl" target="_blank" rel="noopener noreferrer">
                <img :src="m.photoUrl" class="rounded max-h-60" alt="Chat photo" loading="lazy" />
              </a>
            </template>
            <div v-if="m.text">{{ m.text }}</div>
            <div class="text-[10px] opacity-70 mt-1 text-right">{{ dateTime(m.createdAt) }}</div>
          </div>
          <template v-if="isMine(m) && hasSenderInfo(m)">
            <Avatar
              v-if="m.senderPhotoURL && isAllowedPhotoUrl(m.senderPhotoURL)"
              :image="m.senderPhotoURL"
              shape="circle"
              size="normal"
            />
            <Avatar
              v-else
              :label="senderInitial(m)"
              shape="circle"
              size="normal"
              style="background-color: var(--bs-blue); color: white; font-weight: 600;"
            />
          </template>
        </div>
      </template>
    </div>

    <!-- AI-suggested reply chips. Shows up above the composer after the
         tradesperson clicks Suggest. Each chip drops its text into the
         composer on click. Cleared automatically when a new message
         arrives (see the watch on lastMessageId). -->
    <div
      v-if="suggestions.length"
      class="border-t bg-[#f0f7fc] p-3 flex flex-col gap-2"
    >
      <div class="flex items-center justify-between text-xs text-[color:var(--bs-muted)]">
        <span class="font-semibold">
          <i class="pi pi-sparkles mr-1" aria-hidden="true" />
          AI-suggested replies
        </span>
        <button
          type="button"
          class="text-[color:var(--bs-muted)] hover:text-[color:var(--bs-text)]"
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
        class="text-left text-sm rounded-lg border border-[color:var(--bs-border)] bg-white px-3 py-2 hover:border-[color:var(--bs-blue)] hover:bg-[color:var(--bs-blue-light)]/20 transition-colors"
        @click="applySuggestion(s)"
      >
        {{ s }}
      </button>
    </div>

    <form class="border-t bg-white p-3 flex items-end gap-2" @submit.prevent="submit">
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
  </div>
</template>
