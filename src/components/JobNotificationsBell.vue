<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import Popover from "primevue/popover";
import NotificationsPanel from "@/components/NotificationsPanel.vue";
import { useNotificationsStore } from "@/stores/notifications";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { NotificationDoc, WithId } from "@/firebase/interfaces";

// Per-job notification bell shown on each job card (client + tradesperson).
// Every signed-in user already has a live subscription to their own
// notifications via the store, so this is a pure client-side filter by
// jobId — zero extra Firestore reads or listeners per card. The shared
// NotificationsPanel renders the list so the per-job feed looks identical
// to the global bell.
//
// Scope note: the store holds the user's most-recent notifications (the
// app-wide cap), so this surfaces a job's *recent* activity — which is the
// point of the unread badge ("this job has something new"). It isn't a
// full lifetime archive of the job; the global bell shares the same window.
const props = defineProps<{ jobId: string }>();

const notifs = useNotificationsStore();
const router = useRouter();
const toast = useToast();
const popover = ref<InstanceType<typeof Popover> | null>(null);

const items = computed(() => notifs.items.filter((n) => n.jobId === props.jobId));
const unreadCount = computed(() => items.value.filter((n) => !n.read).length);

function toggle(e: Event) {
  popover.value?.toggle(e);
}

async function onOpen(item: WithId<NotificationDoc>) {
  popover.value?.hide();
  await notifs.onOpen(item, router);
}

async function onMarkAllRead() {
  try {
    await notifs.markJobRead(props.jobId);
  } catch (e) {
    toast.error(humanizeError(e));
  }
}
</script>

<template>
  <!-- .stop on click + keydown so activating the bell never also triggers the
       parent card's "open job" handler (cards are clickable + keyboard-focusable). -->
  <button
    type="button"
    class="job-bell"
    :class="{ 'job-bell--unread': unreadCount > 0 }"
    :aria-label="
      unreadCount > 0
        ? `Notifications for this job (${unreadCount} unread)`
        : 'Notifications for this job'
    "
    @click.stop="toggle"
    @keydown.enter.stop
    @keydown.space.stop
  >
    <i class="pi pi-bell" aria-hidden="true"></i>
    <span v-if="unreadCount > 0" class="job-bell__badge" aria-hidden="true">
      {{ unreadCount > 9 ? "9+" : unreadCount }}
    </span>
  </button>

  <Popover ref="popover" :pt="{ root: { style: 'max-width: 92vw;' } }">
    <NotificationsPanel :items="items" @open="onOpen" @mark-all-read="onMarkAllRead" />
  </Popover>
</template>

<style scoped>
.job-bell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.75rem;
  width: 1.75rem;
  border: 0;
  background: transparent;
  border-radius: 9999px;
  color: var(--bs-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 120ms ease, background-color 120ms ease;
}
.job-bell:hover {
  color: var(--bs-text);
  background: var(--bs-surface-alt);
}
.job-bell:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: 2px;
}
.job-bell--unread {
  color: var(--bs-blue);
}
.job-bell .pi-bell {
  font-size: 1rem;
}
.job-bell__badge {
  position: absolute;
  top: -2px;
  right: -2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.25rem;
  border-radius: 9999px;
  /* Unread = red (attention). Matches the global bell's badge. */
  background: var(--bs-red);
  color: white;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}
</style>
