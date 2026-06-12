import { defineStore } from "pinia";
import { watch } from "vue";
import { subscribeSubscriptionState } from "@/firebase/services/subscriptionService";
import { deriveIsPro, isComped, isTrialing, proDaysLeft } from "@/utils/subscription";
import type { SubscriptionState } from "@/firebase/interfaces";
import { useAuthStore } from "@/stores/auth";

interface State {
  subscription: SubscriptionState | null;
  loaded: boolean;
  unsub: (() => void) | null;
  started: boolean;
}

/**
 * Live Blue Seal Pro subscription state for the signed-in tradesperson. Mirrors
 * the notifications store: one auth-uid watcher restarts the Firestore listener
 * on sign-in/out. `isPro` here is the client twin of the server's deriveIsPro —
 * the server is authoritative; this drives what the UI shows.
 */
export const useSubscriptionStore = defineStore("subscription", {
  state: (): State => ({
    subscription: null,
    loaded: false,
    unsub: null,
    started: false,
  }),

  getters: {
    isPro: (s) => deriveIsPro(s.subscription),
    isTrialing: (s) => isTrialing(s.subscription),
    isComped: (s) => isComped(s.subscription),
    daysLeft: (s) => proDaysLeft(s.subscription),
  },

  actions: {
    init() {
      if (this.started) return;
      this.started = true;
      const auth = useAuthStore();
      watch(
        () => auth.fbUser?.uid ?? null,
        () => this.restart(),
        { immediate: true },
      );
    },

    restart() {
      if (this.unsub) {
        this.unsub();
        this.unsub = null;
      }
      const auth = useAuthStore();
      const uid = auth.fbUser?.uid ?? null;
      if (!uid) {
        this.subscription = null;
        this.loaded = false;
        return;
      }
      this.loaded = false;
      this.unsub = subscribeSubscriptionState(uid, (s) => {
        this.subscription = s;
        this.loaded = true;
      });
    },
  },
});
