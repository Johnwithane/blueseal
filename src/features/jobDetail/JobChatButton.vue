<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { subscribeChat } from "@/firebase/services/chats";
import { useAuthStore } from "@/stores/auth";
import type { ChatDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  chatId: string;
  // When true, lift the button above the sticky bottom CTA so they don't
  // stack on top of each other.
  liftForCta: boolean;
  // The AI sub-tab inside the overlay is tradesperson-only — so the client
  // pill should just say "Chat". Defaults to false (client view) when omitted.
  isTradie?: boolean;
}>();

const emit = defineEmits<{
  click: [];
}>();

const auth = useAuthStore();

// Live chat metadata. We only need it for the unread count; the rest of the
// chat surface stays inside the overlay's ChatThread.
const chat = ref<WithId<ChatDoc> | null>(null);
let unsub: (() => void) | null = null;

function attach(id: string) {
  unsub?.();
  unsub = subscribeChat(id, (c) => {
    chat.value = c;
  });
}

watch(
  () => props.chatId,
  (id) => {
    if (id) attach(id);
  },
  { immediate: true },
);

onBeforeUnmount(() => unsub?.());

const unreadCount = computed(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) return 0;
  return chat.value?.unreadCounts?.[uid] ?? 0;
});
</script>

<template>
  <button
    type="button"
    class="job-chat-button"
    :class="{ 'job-chat-button--lifted': liftForCta }"
    :aria-label="unreadCount > 0
      ? `Open ${props.isTradie ? 'chat and AI' : 'chat'} (${unreadCount} unread)`
      : `Open ${props.isTradie ? 'chat and AI' : 'chat'}`"
    @click="emit('click')"
  >
    <i class="pi pi-comments icon" aria-hidden="true"></i>
    <span class="label">{{ props.isTradie ? "Chat &amp; AI" : "Chat" }}</span>
    <span
      v-if="unreadCount > 0"
      class="badge"
      :aria-label="`${unreadCount} unread`"
    >
      {{ unreadCount > 99 ? "99+" : unreadCount }}
    </span>
  </button>
</template>

<style scoped>
.job-chat-button {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 35;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 1.1rem 0 0.9rem;
  height: 3.25rem;
  border: none;
  border-radius: 9999px;
  background: linear-gradient(135deg, var(--bs-blue), var(--bs-blue-dark));
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(29, 64, 106, 0.32);
  transition: transform 120ms ease, box-shadow 120ms ease, bottom 200ms ease;
}

.job-chat-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px rgba(29, 64, 106, 0.4);
}

.job-chat-button:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: 2px;
}

/* Lift above the sticky CTA bar (~76px tall) when one is present so the
   button isn't sitting on top of the "Prepare quote" / "Finish job" button. */
.job-chat-button--lifted {
  bottom: calc(5rem + env(safe-area-inset-bottom));
}

.icon {
  font-size: 1.1rem;
  line-height: 1;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.4rem;
  border-radius: 9999px;
  /* Unread = brand red (attention), shared with the notification badges. */
  background: var(--bs-red);
  color: white;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1;
  margin-left: 0.15rem;
}

@media (max-width: 380px) {
  /* Tightest phones: drop the label to keep the pill compact, badge stays. */
  .label {
    display: none;
  }
  .job-chat-button {
    padding: 0 0.85rem;
  }
}
</style>
