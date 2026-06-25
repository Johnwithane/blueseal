import { onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { safeRedirect } from "@/utils/redirect";

// Google One Tap ("Continue as <name>") via Google Identity Services. Gated on
// VITE_GOOGLE_OAUTH_CLIENT_ID: with no client ID configured the composable is a
// no-op, so the "Continue with Google" button keeps working and One Tap simply
// never appears. The client ID must be the SAME OAuth 2.0 Web Client ID that
// backs Firebase Auth's Google provider (so signInWithCredential accepts the
// token's audience), with the site's origin added to its authorized JS origins.
// See HUMANTASKS.md.
const GIS_SRC = "https://accounts.google.com/gsi/client";
const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? "";

interface CredentialResponse {
  credential?: string;
}

interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (res: CredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
    context?: "signin" | "signup" | "use";
  }): void;
  prompt(): void;
  cancel(): void;
}

type GsiWindow = Window & {
  google?: { accounts?: { id?: GoogleIdApi } } };

// Load the GIS script once per page-load, shared across both auth views.
let scriptPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${GIS_SRC}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Show the Google One Tap prompt on a logged-out auth page. Call `start()` from
 * onMounted. New accounts route to the forced /welcome role choice; returning
 * users land on their redirect target (or the dashboard). Any failure (no client
 * ID, blocked script, FedCM dismissed) is silent — the button is the fallback.
 */
export function useGoogleOneTap(opts?: { context?: "signin" | "signup" }) {
  const auth = useAuthStore();
  const router = useRouter();
  const route = useRoute();
  const enabled = CLIENT_ID.length > 0;
  let cancelled = false;

  async function handleCredential(res: CredentialResponse) {
    if (!res.credential) return;
    try {
      const { isNew } = await auth.signInWithGoogleCredential(res.credential);
      if (isNew) {
        router.replace({
          name: "Welcome",
          query:
            typeof route.query.redirect === "string" ? { redirect: route.query.redirect } : {},
        });
        return;
      }
      router.replace(safeRedirect(route.query.redirect));
    } catch {
      // One Tap is a convenience; on failure the user falls back to the button.
      // The store already captured the error message.
    }
  }

  async function start() {
    if (!enabled) return;
    // Never One Tap an already-signed-in user.
    if (!auth.ready) await auth.init();
    if (auth.isAuthenticated || cancelled) return;
    try {
      await loadGis();
    } catch {
      return; // network / ad-block — stay silent, button still works
    }
    if (cancelled) return;
    const idApi = (window as GsiWindow).google?.accounts?.id;
    if (!idApi) return;
    idApi.initialize({
      client_id: CLIENT_ID,
      callback: handleCredential,
      auto_select: false,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
      context: opts?.context ?? "signin",
    });
    idApi.prompt();
  }

  onBeforeUnmount(() => {
    cancelled = true;
    if (enabled) (window as GsiWindow).google?.accounts?.id?.cancel();
  });

  return { start, enabled };
}
