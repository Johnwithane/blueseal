import { defineStore } from "pinia";
import { watch } from "vue";
import type { Router } from "vue-router";
import {
  markAllRead,
  markNotificationRead,
  subscribeMyNotifications,
} from "@/firebase/services/notifications";
import {
  resetJobBoardCount as clearJobBoardCounter,
  subscribeJobBoardCount,
} from "@/firebase/services/jobBoard";
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
  // Separate listener for the "new jobs in your area" badge counter
  // (jobBoardCounters/{uid}). Lives in this store because it's another
  // auth-scoped header badge — restarted alongside the inbox on uid change.
  jobBoardUnsub: (() => void) | null;
  started: boolean;
  // Chat the user is *actively reading* right now (chat sub-tab visible in
  // the JobChatOverlay). Set by the overlay, cleared on close / AI sub-tab /
  // unmount. The App.vue toast watcher uses this to suppress `message_received`
  // toasts for the chat the user is already looking at — the inbox doc is
  // still written so the bell badge survives if they navigate away.
  activeChatId: string | null;
  // Count of new job posts in the tradesperson's area since they last opened
  // the board — rendered as a badge on the "Browse open jobs" nav button.
  jobBoardCount: number;
}

export const useNotificationsStore = defineStore("notifications", {
  state: (): State => ({
    items: [],
    loading: false,
    unsub: null,
    jobBoardUnsub: null,
    started: false,
    activeChatId: null,
    jobBoardCount: 0,
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
      if (this.jobBoardUnsub) {
        this.jobBoardUnsub();
        this.jobBoardUnsub = null;
      }
      const auth = useAuthStore();
      if (!auth.isAuthenticated) {
        this.items = [];
        this.jobBoardCount = 0;
        return;
      }
      this.loading = true;
      this.unsub = subscribeMyNotifications((items) => {
        this.items = items;
        this.loading = false;
      });
      // Tradesperson-only in practice — the doc only exists for tradies the
      // fan-out has flagged — but subscribing for everyone is harmless (a
      // client's doc is simply absent → count 0) and survives role switches.
      this.jobBoardUnsub = subscribeJobBoardCount((count) => {
        this.jobBoardCount = count;
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

    setActiveChat(chatId: string | null) {
      this.activeChatId = chatId;
    },

    async markAllRead() {
      const unreadIds = this.items.filter((n) => !n.read).map((n) => n.id);
      if (unreadIds.length === 0) return;
      await markAllRead(unreadIds);
    },

    /**
     * Clear the "new jobs in your area" badge — the tradesperson just opened
     * the board. Optimistically zero the local count so the badge disappears
     * instantly; the snapshot listener reconciles. Fire-and-forget so a slow
     * write never blocks the board from rendering.
     */
    resetJobBoardCount() {
      this.jobBoardCount = 0;
      clearJobBoardCounter().catch(() => {
        /* listener will restore the true count if the reset write fails */
      });
    },
  },
});
