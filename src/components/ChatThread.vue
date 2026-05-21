<script setup lang="ts">
import { onMounted, onUnmounted, ref, nextTick, watch } from "vue";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import {
  subscribeMessages,
  sendMessage,
  markRead,
} from "@/firebase/services/chats";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import type { MessageDoc, WithId } from "@/firebase/interfaces";
import { useAuthStore } from "@/stores/auth";
import { useFormatters } from "@/composables/useFormatters";

const props = defineProps<{
  chatId: string;
  recipientId: string;
}>();

const auth = useAuthStore();
const { dateTime } = useFormatters();

const messages = ref<WithId<MessageDoc>[]>([]);
const text = ref("");
const sending = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
let unsub: (() => void) | null = null;

onMounted(() => {
  unsub = subscribeMessages(props.chatId, (m) => {
    messages.value = m;
    if (auth.fbUser) markRead(props.chatId, auth.fbUser.uid).catch(() => {});
    nextTick(() => scroller.value?.scrollTo({ top: scroller.value.scrollHeight }));
  });
});

watch(
  () => props.chatId,
  (next, prev) => {
    if (next === prev) return;
    unsub?.();
    unsub = subscribeMessages(next, (m) => (messages.value = m));
  },
);

onUnmounted(() => unsub?.());

async function submit() {
  if (!auth.fbUser || !text.value.trim()) return;
  sending.value = true;
  try {
    await sendMessage({
      chatId: props.chatId,
      senderId: auth.fbUser.uid,
      recipientId: props.recipientId,
      text: text.value.trim(),
    });
    text.value = "";
  } finally {
    sending.value = false;
  }
}

async function uploadPhoto(e: Event) {
  if (!auth.fbUser) return;
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  const path = makeStoragePath({ scope: "chats", id: props.chatId, filename: file.name });
  const url = await uploadFile(path, file);
  await sendMessage({
    chatId: props.chatId,
    senderId: auth.fbUser.uid,
    recipientId: props.recipientId,
    text: "",
    photoUrl: url,
  });
  target.value = "";
}
</script>

<template>
  <div class="flex flex-col h-[60vh] bs-card overflow-hidden">
    <div ref="scroller" class="flex-1 overflow-y-auto p-4 space-y-3 bg-[#f9fafb]">
      <div v-if="!messages.length" class="text-center text-sm text-[color:var(--bs-muted)] py-8">
        No messages yet — say hi.
      </div>
      <div
        v-for="m in messages"
        :key="m.id"
        :class="['flex', m.senderId === auth.fbUser?.uid ? 'justify-end' : 'justify-start']"
      >
        <div
          :class="[
            'max-w-[75%] rounded-2xl px-3 py-2 text-sm',
            m.senderId === auth.fbUser?.uid
              ? 'bg-[color:var(--bs-blue)] text-white'
              : 'bg-white border border-[color:var(--bs-border)]',
          ]"
        >
          <template v-if="m.photoUrl">
            <a :href="m.photoUrl" target="_blank" rel="noopener">
              <img :src="m.photoUrl" class="rounded max-h-60" alt="" />
            </a>
          </template>
          <div v-if="m.text">{{ m.text }}</div>
          <div class="text-[10px] opacity-70 mt-1 text-right">{{ dateTime(m.createdAt) }}</div>
        </div>
      </div>
    </div>

    <form class="border-t bg-white p-3 flex items-end gap-2" @submit.prevent="submit">
      <Textarea
        v-model="text"
        rows="1"
        auto-resize
        placeholder="Write a message…"
        class="flex-1"
      />
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="uploadPhoto" />
      <Button icon="pi pi-image" outlined type="button" @click="fileInput?.click()" />
      <Button icon="pi pi-send" type="submit" :loading="sending" :disabled="!text.trim()" />
    </form>
  </div>
</template>
