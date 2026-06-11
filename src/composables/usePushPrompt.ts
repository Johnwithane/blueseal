import { useConfirm } from "primevue/useconfirm";
import { useToast } from "@/composables/useToast";
import { useAuthStore } from "@/stores/auth";
import {
  enablePush,
  pushConfigured,
  pushEnabledLocally,
  pushSupported,
} from "@/firebase/services/push";
import { humanizeError } from "@/utils/errors";

// Per-device "we've offered push once" marker. Separate from push.ts's
// `bs-push-token` (which means "enabled here") so that declining the soft-ask
// — or enabling then later disabling — doesn't make us nag again. Users can
// always turn push on later from Account → Notifications.
const ASKED_KEY = "bs-push-asked";

function alreadyAsked(): boolean {
  try {
    return !!localStorage.getItem(ASKED_KEY);
  } catch {
    return false;
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* private mode — worst case we offer again next session, no harm */
  }
}

/**
 * Soft-ask the signed-in user to turn on web push for THIS device.
 *
 * It shows our own confirm dialog first and only fires the real browser
 * permission prompt when they click "Enable" — that click is a genuine user
 * gesture (so Safari/iOS are happy) and a "Not now" never burns the browser
 * permission, so we can ask again another day. No-ops silently when push is
 * unconfigured/unsupported, already on here, already decided in the browser,
 * or we've offered on this device before. Safe to call from any handler.
 */
export function usePushPrompt() {
  const confirm = useConfirm();
  const toast = useToast();
  const auth = useAuthStore();

  async function maybePromptForPush(opts: {
    message: string;
    header?: string;
  }): Promise<void> {
    const uid = auth.fbUser?.uid;
    if (!uid) return;
    if (!pushConfigured()) return;
    if (alreadyAsked()) return;
    // Only ask when the browser hasn't decided yet. "granted" → nothing to
    // offer; "denied" → can't re-grant without browser settings, and leaving
    // ASKED unset means we'll offer again if they unblock us later.
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    if (pushEnabledLocally()) return;
    if (!(await pushSupported())) return;

    // Mark before showing so a reload mid-decision (or dismiss) doesn't re-nag.
    markAsked();
    confirm.require({
      header: opts.header ?? "Turn on notifications?",
      message: opts.message,
      icon: "pi pi-bell",
      rejectProps: { label: "Not now", severity: "secondary", outlined: true },
      acceptProps: { label: "Enable", icon: "pi pi-check" },
      accept: async () => {
        try {
          await enablePush(uid);
          toast.success("Notifications on", "We'll alert you on this device.");
        } catch (e) {
          toast.error("Couldn't enable notifications", humanizeError(e));
        }
      },
    });
  }

  return { maybePromptForPush };
}
