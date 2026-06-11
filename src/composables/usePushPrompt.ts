import { watch } from "vue";
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

// Per-device "when did we last offer push" marker. Separate from push.ts's
// `bs-push-token` (which means "enabled here"). Push is essential to the
// product — job requests, quotes, and messages are all time-critical — so a
// "Not now" doesn't silence us forever: we re-offer after a cooldown, every
// signed-in session, until this device is on. Users can always flip it from
// Account → Notifications.
const ASKED_KEY = "bs-push-asked";
// Re-offer at most once a day — persistent without being hostile. The
// pre-cooldown value of this key was the literal "1" ("asked once, never
// again"); Number("1") reads as an ancient epoch-ms, so devices that
// declined under the old policy become eligible again immediately.
const ASK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function askedRecently(): boolean {
  try {
    const raw = localStorage.getItem(ASKED_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < ASK_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, String(Date.now()));
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
 * unconfigured/unsupported, already on here, denied in the browser, or
 * offered on this device within the cooldown. Safe to call from any handler.
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
    if (typeof Notification === "undefined") return;
    if (pushEnabledLocally()) return;
    if (!(await pushSupported())) return;

    // The browser already trusts us but this device isn't registered (cleared
    // site data, or a sign-in on a device that granted before). No prompt is
    // needed or shown — requestPermission resolves instantly when already
    // granted — so register quietly. This is what makes push effectively
    // "on by default" wherever the permission exists.
    if (Notification.permission === "granted") {
      try {
        await enablePush(uid);
      } catch {
        /* non-fatal — the next session retries */
      }
      return;
    }

    // "denied" can't be re-granted from JS — only browser settings. Leaving
    // ASKED untouched means we offer again if they ever unblock us.
    if (Notification.permission !== "default") return;
    if (askedRecently()) return;

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

/**
 * App-level companion: offer push for EVERY signed-in session until this
 * device is on. Watches for a session landing (uid + activeRole resolved —
 * the role drives the copy) and fires the soft-ask, which covers signup,
 * sign-in, and returning sessions in one place. maybePromptForPush's own
 * guards make eager firing safe — enabled, denied, unsupported, and
 * within-cooldown all no-op. Call once from App.vue setup.
 */
export function usePushAutoPrompt(): void {
  const auth = useAuthStore();
  const { maybePromptForPush } = usePushPrompt();
  let offeredUid: string | null = null;

  watch(
    // null until BOTH uid and activeRole are known — during signup the role
    // lands last (signUp/applyAuthState), so this also keeps the ask from
    // firing mid-provisioning with no role context.
    () => (auth.activeRole ? (auth.fbUser?.uid ?? null) : null),
    (uid) => {
      if (!uid || uid === offeredUid) return;
      offeredUid = uid;
      void maybePromptForPush(
        auth.activeRole === "tradesperson"
          ? {
              header: "Never miss a job",
              message:
                "Get an instant alert when a client requests you or messages about a job — even when Blue Seal is closed.",
            }
          : {
              header: "Turn on notifications?",
              message:
                "Get an instant alert when a tradesperson replies, quotes, or messages you — even when Blue Seal is closed.",
            },
      );
    },
    { immediate: true },
  );
}
