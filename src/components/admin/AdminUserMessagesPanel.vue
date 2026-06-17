<script setup lang="ts">
// Message history for one account: every job chat thread they're party to, with
// each thread expandable to read the conversation (admin can read any chat per
// firestore.rules). Used for dispute support. Self-contained + cleans up its
// live message subscription on collapse/unmount.
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Message from "primevue/message";
import { listChatsForUser, subscribeMessages } from "@/firebase/services/chats";
import { useFormatters } from "@/composables/useFormatters";
import type { ChatDoc, MessageDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{ uid: string }>();
const { relativeTime, dateTime } = useFormatters();

const chats = ref<WithId<ChatDoc>[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const openChatId = ref<string | null>(null);
const messages = ref<WithId<MessageDoc>[]>([]);
let unsub: (() => void) | null = null;

onMounted(async () => {
  try {
    chats.value = await listChatsForUser(props.uid);
  } catch {
    error.value = "Couldn't load conversations — the index may still be building.";
  } finally {
    loading.value = false;
  }
});

function closeThread() {
  if (unsub) {
    unsub();
    unsub = null;
  }
  openChatId.value = null;
  messages.value = [];
}
function toggleThread(id: string) {
  if (openChatId.value === id) {
    closeThread();
    return;
  }
  closeThread();
  openChatId.value = id;
  unsub = subscribeMessages(id, (m) => (messages.value = m), { tail: 100 });
}
onUnmounted(closeThread);
</script>

<template>
  <section>
    <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">
      Message history
    </h3>
    <p v-if="loading" class="text-xs text-[color:var(--bs-muted)]">Loading…</p>
    <Message v-else-if="error" severity="warn" :closable="false">{{ error }}</Message>
    <p v-else-if="!chats.length" class="text-xs text-[color:var(--bs-muted)]">No conversations.</p>
    <ul v-else class="space-y-2">
      <li v-for="c in chats" :key="c.id" class="rounded border border-[color:var(--bs-border)] p-2 text-sm">
        <button type="button" class="flex w-full items-center justify-between gap-2 text-left" @click="toggleThread(c.id)">
          <span class="min-w-0">
            <span class="font-medium">Job <code>{{ (c.jobId || "").slice(0, 8) }}…</code></span>
            <span class="block text-xs text-[color:var(--bs-muted)] truncate">{{ c.lastMessagePreview || "—" }}</span>
          </span>
          <span class="flex-none text-xs text-[color:var(--bs-muted)]">
            {{ c.lastMessageAt ? relativeTime(c.lastMessageAt) : "" }}
          </span>
        </button>
        <div v-if="openChatId === c.id" class="mt-2 space-y-1 border-t border-[color:var(--bs-border)] pt-2">
          <RouterLink :to="{ name: 'JobDetail', params: { id: c.jobId } }" class="text-xs text-[color:var(--bs-blue)] hover:underline">
            Open job →
          </RouterLink>
          <p v-for="m in messages" :key="m.id" class="text-sm">
            <span class="font-medium">{{ m.senderName || (m.senderId === uid ? "This user" : m.senderId.slice(0, 8)) }}:</span>
            {{ m.text }}
            <span class="block text-[10px] text-[color:var(--bs-muted)]">{{ dateTime(m.createdAt) }}</span>
          </p>
          <p v-if="!messages.length" class="text-xs text-[color:var(--bs-muted)]">No messages in this thread.</p>
        </div>
      </li>
    </ul>
  </section>
</template>
