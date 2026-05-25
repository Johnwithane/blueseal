import { defineStore } from "pinia";
import type { Role } from "@/firebase/interfaces";

// Total overlay lifetime in milliseconds — covers fade-in, hold, and fade-out.
// Kept in sync with the CSS transitions in RoleSwitchOverlay.vue; if you bump
// one, bump the other.
export const ROLE_SWITCH_ANIMATION_MS = 1200;

interface State {
  // The role the user is switching INTO. Drives the overlay's icon + label.
  // Null when no animation is playing.
  targetRole: Role | null;
  // Bumps every time `play()` is invoked so the overlay can re-mount if the
  // user fires another switch while one is already in flight (rare, but the
  // router auto-switch can race with a deliberate switch on slow networks).
  playId: number;
}

let pendingTimer: ReturnType<typeof setTimeout> | null = null;

export const useRoleSwitchAnimationStore = defineStore("roleSwitchAnimation", {
  state: (): State => ({
    targetRole: null,
    playId: 0,
  }),
  actions: {
    /**
     * Show the role-switch overlay for the configured duration. Safe to call
     * back-to-back — the latest call wins (older timer is cancelled) so a
     * second switch doesn't get cut short by the first one's timeout.
     */
    play(role: Role) {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      this.targetRole = role;
      this.playId += 1;
      pendingTimer = setTimeout(() => {
        this.targetRole = null;
        pendingTimer = null;
      }, ROLE_SWITCH_ANIMATION_MS);
    },
    /** Cancel an in-flight animation immediately (used in tests + sign-out). */
    stop() {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      this.targetRole = null;
    },
  },
});
