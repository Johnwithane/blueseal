<script setup lang="ts">
import { computed } from "vue";
import type { NotificationDoc, NotificationType, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";

const props = defineProps<{
  items: WithId<NotificationDoc>[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  open: [item: WithId<NotificationDoc>];
  markAllRead: [];
}>();

const { relativeTime } = useFormatters();

const unreadCount = computed(() => props.items.filter((n) => !n.read).length);

// Icon lookup mirrors the types in `NotificationType`; keeping it inline so a
// future contributor adding a type sees the visual mapping in one place.
const ICON: Record<NotificationType, string> = {
  message_received: "pi pi-comment",
  job_requested: "pi pi-briefcase",
  job_cancelled: "pi pi-ban",
  new_application: "pi pi-send",
  application_accepted: "pi pi-check-circle",
  application_rejected: "pi pi-times-circle",
  application_returned: "pi pi-refresh",
  vetting_approved: "pi pi-shield",
  vetting_rejected: "pi pi-times-circle",
  vetting_info_requested: "pi pi-info-circle",
  cert_approved: "pi pi-file",
  id_approved: "pi pi-id-card",
  insurance_approved: "pi pi-verified",
  wsib_approved: "pi pi-verified",
  invoice_sent: "pi pi-file",
  invoice_paid: "pi pi-check-circle",
  invoice_payment_failed: "pi pi-exclamation-triangle",
  invoice_refunded: "pi pi-replay",
  dispute_opened: "pi pi-exclamation-triangle",
  review_received: "pi pi-star",
  vouch_requested: "pi pi-user-plus",
  vouch_accepted: "pi pi-thumbs-up",
};

function iconFor(type: NotificationType): string {
  return ICON[type] ?? "pi pi-bell";
}
</script>

<template>
  <div class="w-80 max-w-[92vw]">
    <div
      class="flex items-center justify-between border-b border-[color:var(--bs-border)] px-3 py-2"
    >
      <span class="text-sm font-semibold">Notifications</span>
      <button
        v-if="unreadCount > 0"
        type="button"
        class="text-xs font-medium text-[color:var(--bs-blue)] hover:underline"
        @click="emit('markAllRead')"
      >
        Mark all read
      </button>
    </div>

    <div v-if="loading" class="px-3 py-6 text-center text-sm text-[color:var(--bs-text-muted)]">
      Loading…
    </div>

    <div
      v-else-if="items.length === 0"
      class="px-3 py-8 text-center text-sm text-[color:var(--bs-text-muted)]"
    >
      <i class="pi pi-bell-slash mb-2 block text-2xl text-[color:var(--bs-border)]"></i>
      You're all caught up.
    </div>

    <ul v-else class="max-h-96 overflow-y-auto">
      <li
        v-for="n in items"
        :key="n.id"
        class="flex cursor-pointer items-start gap-2 border-b border-[color:var(--bs-border)] px-3 py-2 last:border-b-0 hover:bg-[color:var(--bs-surface-alt)]"
        :class="{ 'bg-[color:var(--bs-surface-alt)]/40': !n.read }"
        @click="emit('open', n)"
      >
        <span
          class="mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm"
          :class="
            n.read
              ? 'bg-[color:var(--bs-surface-alt)] text-[color:var(--bs-text-muted)]'
              : 'bg-[color:var(--bs-blue)]/10 text-[color:var(--bs-blue)]'
          "
        >
          <i :class="iconFor(n.type)"></i>
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-2">
            <span
              class="truncate text-sm"
              :class="n.read ? 'text-[color:var(--bs-text)]' : 'font-semibold text-[color:var(--bs-text)]'"
            >
              {{ n.title }}
            </span>
            <span class="flex-none text-xs text-[color:var(--bs-text-muted)]">
              {{ relativeTime(n.createdAt) }}
            </span>
          </div>
          <p class="line-clamp-2 text-xs text-[color:var(--bs-text-muted)]">{{ n.body }}</p>
        </div>
        <span
          v-if="!n.read"
          aria-label="Unread"
          class="mt-1.5 inline-block h-2 w-2 flex-none rounded-full bg-[color:var(--bs-blue)]"
        ></span>
      </li>
    </ul>
  </div>
</template>
