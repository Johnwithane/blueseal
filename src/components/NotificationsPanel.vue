<script setup lang="ts">
import { computed } from "vue";
import Avatar from "primevue/avatar";
import type { NotificationDoc, NotificationType, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { roleBadge } from "@/utils/notifications";
import { useAuthStore } from "@/stores/auth";

const props = defineProps<{
  items: WithId<NotificationDoc>[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  open: [item: WithId<NotificationDoc>];
  markAllRead: [];
}>();

const { relativeTime } = useFormatters();
const auth = useAuthStore();

const unreadCount = computed(() => props.items.filter((n) => !n.read).length);

// Only stamp rows with a per-role badge when the account actually spans more
// than one view (e.g. admin + tradesperson + sales). A single-role user has
// just one context, so the badge would be redundant noise. "qa" is a
// capability, not a view-mode, so it doesn't count toward "multi-role".
const showRoleBadge = computed(() => auth.roles.filter((r) => r !== "qa").length > 1);

// Resolve each row's role badge once (gated by showRoleBadge) so the template
// doesn't recompute it for both the left accent and the chip.
const rows = computed(() =>
  props.items.map((n) => ({
    n,
    badge: showRoleBadge.value ? roleBadge(n.recipientRole) : null,
  })),
);

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
  application_message: "pi pi-comments",
  application_declined: "pi pi-times-circle",
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
  review_requested: "pi pi-star",
  review_reminder: "pi pi-star",
  review_revealed: "pi pi-eye",
  vouch_requested: "pi pi-user-plus",
  vouch_accepted: "pi pi-thumbs-up",
  recommendation_received: "pi pi-user-plus",
  recommendation_accepted: "pi pi-thumbs-up",
  new_job_posting: "pi pi-briefcase",
  prospect_claimed: "pi pi-user-plus",
  invite_claimed: "pi pi-user-plus",
  job_change_requested: "pi pi-pause",
  job_change_accepted: "pi pi-check-circle",
  job_change_declined: "pi pi-times-circle",
  job_change_withdrawn: "pi pi-undo",
  job_resumed: "pi pi-play",
  change_order_proposed: "pi pi-plus-circle",
  change_order_approved: "pi pi-check-circle",
  change_order_declined: "pi pi-times-circle",
  site_visit_proposed: "pi pi-map-marker",
  site_visit_agreed: "pi pi-check-circle",
  site_visit_declined: "pi pi-times-circle",
  job_referred: "pi pi-share-alt",
  referral_applied: "pi pi-send",
  insurance_expiry_reminder: "pi pi-shield",
  pm_featured: "pi pi-star",
};

function iconFor(type: NotificationType): string {
  return ICON[type] ?? "pi pi-bell";
}

// Initial used for the avatar fallback when the actor has a denormalized
// displayName but no photoURL (or the photo fails to load). Falls back to
// "?" rather than blank so the circle is never visually empty.
function initialFor(name: string | null): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : "?";
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
        v-for="{ n, badge } in rows"
        :key="n.id"
        class="flex cursor-pointer items-start gap-2 border-b border-l-[3px] border-[color:var(--bs-border)] px-3 py-2 last:border-b-0 hover:bg-[color:var(--bs-surface-alt)]"
        :class="{ 'bg-[color:var(--bs-surface-alt)]/40': !n.read }"
        :style="{ borderLeftColor: badge ? badge.accent : 'transparent' }"
        @click="emit('open', n)"
      >
        <!--
          When the notification carries an actor snapshot (tradie messaging
          their client, client accepting a quote, recommendation accepted,
          etc.) show that person's avatar so the row is immediately
          recognisable. System / actor-less notifications (vetting,
          invoice-paid webhooks, legacy docs) fall back to the type icon.
        -->
        <template v-if="n.actorPhotoURL || n.actorDisplayName">
          <Avatar
            v-if="n.actorPhotoURL"
            :image="n.actorPhotoURL"
            shape="circle"
            class="mt-0.5 flex-none"
            style="width: 1.75rem; height: 1.75rem;"
          />
          <Avatar
            v-else
            :label="initialFor(n.actorDisplayName)"
            shape="circle"
            class="mt-0.5 flex-none"
            style="width: 1.75rem; height: 1.75rem; background-color: var(--bs-blue); color: white; font-weight: 600;"
          />
        </template>
        <span
          v-else
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
          <!--
            Role chip: which VIEW this notification is for. Only present for
            multi-role accounts (see showRoleBadge) so single-role users aren't
            shown a redundant tag on every row.
          -->
          <span
            v-if="badge"
            class="mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none"
            :style="{ backgroundColor: badge.tint, color: badge.text }"
          >
            <i :class="badge.icon" class="text-[10px]" aria-hidden="true"></i>
            {{ badge.label }}
          </span>
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
