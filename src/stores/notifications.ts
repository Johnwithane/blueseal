import { defineStore } from "pinia";
import { watch } from "vue";
import type { Router } from "vue-router";
import {
  markAllRead,
  markNotificationRead,
  subscribeMyNotifications,
} from "@/firebase/services/notifications";
import { findJobIdByChatId } from "@/firebase/services/jobs";
import {
  resolveNotificationLink,
  shouldSwitchRoleForNotification,
} from "@/utils/notifications";
import type { NotificationDoc, WithId } from "@/firebase/interfaces";
import { useAuthStore } from "@/stores/auth";

interface State {
  items: WithId<NotificationDoc>[];
  loading: boolean;
  // Lifecycle: a single watcher restarts the Firestore subscription whenever
  // the signed-in uid changes. We hold the unsubscribe handle so sign-out and
  // tear-down can cancel it cleanly. `started` guards against double-init in
  // dev (vite HMR re-runs App.vue's onMounted).
  unsub: (() => void) | null;
  started: boolean;
}

export const useNotificationsStore = defineStore("notifications", {
  state: (): State => ({
    items: [],
    loading: false,
    unsub: null,
    started: false,
  }),

  getters: {
    unreadCount: (s) => s.items.filter((n) => !n.read).length,
  },

  actions: {
    /**
     * Wire up the cross-session subscription. Call this once from App.vue's
     * onMounted — it sets up a watcher on the auth uid and restarts the
     * Firestore listener whenever it changes. Idempotent.
     */
    init() {
      if (this.started) return;
      this.started = true;
      const auth = useAuthStore();
      watch(
        () => auth.fbUser?.uid ?? null,
        () => this.restartSubscription(),
        { immediate: true },
      );
    },

    restartSubscription() {
      if (this.unsub) {
        this.unsub();
        this.unsub = null;
      }
      const auth = useAuthStore();
      if (!auth.isAuthenticated) {
        this.items = [];
        return;
      }
      this.loading = true;
      this.unsub = subscribeMyNotifications((items) => {
        this.items = items;
        this.loading = false;
      });
    },

    /**
     * Open flow for a single notification. Mirrors what AppHeader used to
     * do inline: fire-and-forget mark-read, repair legacy /jobs/pending
     * deep-links, auto-switch the active role if the notification was
     * raised for a different hat, then navigate. Router is passed in so
     * the store stays decoupled from a specific router instance.
     */
    async onOpen(item: WithId<NotificationDoc>, router: Router) {
      const auth = useAuthStore();

      // Fire-and-forget the mark-read — the snapshot listener will reconcile.
      // Don't await; a slow Firestore round-trip shouldn't delay navigation.
      if (!item.read) {
        markNotificationRead(item.id).catch(() => {
          /* surfaced via UI eventually if write fails persistently */
        });
      }

      let link = resolveNotificationLink(item);
      if (!link) return;

      // Repair legacy `/jobs/pending` deep-links: an old bug created chats
      // with `jobId: "pending"` and rules now prevent patching the chat.
      // Recover the real jobId from the job doc (it stores chatId) so the
      // user lands on the correct job instead of the 404-ish JobDetailView.
      if (link.startsWith("/jobs/pending") && item.chatId && auth.fbUser) {
        try {
          const realJobId = await findJobIdByChatId(item.chatId, auth.fbUser.uid);
          if (realJobId) link = link.replace("/jobs/pending", `/jobs/${realJobId}`);
        } catch {
          /* fall through with the original link; user lands on a not-found state */
        }
      }

      // Multi-role accounts: if the notification was raised for the user
      // wearing a different hat than they're currently wearing, flip the
      // active role BEFORE navigating so the page renders in the right
      // context (header chrome, role-gated tabs in JobPostDetailView, etc).
      if (shouldSwitchRoleForNotification(item, auth.activeRole, auth.roles)) {
        try {
          await auth.switchActiveRole(item.recipientRole);
        } catch {
          /* persistence failed — push anyway so the user isn't stranded */
        }
      }
      router.push(link);
    },

    async markAllRead() {
      const unreadIds = this.items.filter((n) => !n.read).map((n) => n.id);
      if (unreadIds.length === 0) return;
      await markAllRead(unreadIds);
    },
  },
});
