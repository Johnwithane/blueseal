import { ref, type Ref } from "vue";
import { useRegisterSW } from "virtual:pwa-register/vue";
import { evaluateVersion, type RemoteVersion } from "@/utils/appVersion";

/**
 * Tells a running Blue Seal client when a newer build has shipped, and gives the
 * user a one-tap way to move to it.
 *
 * Single source of truth: `/version.json`. The app bakes its own build id in at
 * compile time (`__APP_VERSION__`) and polls this tiny, network-only manifest
 * (served `no-cache`, kept out of the precache) to learn the build the server is
 * actually serving. If the two differ, we're behind — show the banner. A
 * `critical` flag escalates to a blocking "Update required" overlay.
 *
 * Why not the service worker's `needRefresh` signal? Because `index.html` is
 * served `no-cache`, the browser always loads the freshest HTML → freshest
 * hashed JS, so the *running code already is the latest build*. The SW precache,
 * though, refreshes on its own schedule and would flip `needRefresh` (→ a banner)
 * even when we're already current. That's a false positive. `version.json` is an
 * exact build-id comparison, so it never cries wolf. The SW is still registered
 * (install + offline) — we just don't use it to *detect* updates.
 *
 * Applying is a guaranteed reload that can never hang the spinner: skip-waiting
 * the new worker if one's ready, otherwise drop the SW caches and hard-reload —
 * and a failsafe timer reloads regardless if neither path completes in time.
 *
 * Module-level singleton: call `useAppUpdate()` once at the app root, then
 * anywhere else for its reactive state.
 */

// Build id baked in at compile time by vite's `define` (see vite.config.ts).
// `typeof` guard so unit tests / any context where `define` isn't applied just
// read "dev" and never prompt.
const LOCAL_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

const VERSION_URL = "/version.json";
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // backstop re-check every 30 min
const RELOAD_FAILSAFE_MS = 2500; // hard ceiling: the spinner never hangs past this

// ── singleton state, shared across every useAppUpdate() caller ───────────────
const updateAvailable = ref(false); // a newer build exists → show the banner
const updateRequired = ref(false); // newer build is critical → blocking overlay
const applying = ref(false); // an apply is in flight (button spinner)
let started = false;

export function useAppUpdate(): {
  updateAvailable: Ref<boolean>;
  updateRequired: Ref<boolean>;
  applying: Ref<boolean>;
  applyUpdate: () => Promise<void>;
} {
  if (!started) {
    started = true;
    start();
  }
  return { updateAvailable, updateRequired, applying, applyUpdate };
}

function start(): void {
  // Register the service worker (for install + offline). We deliberately ignore
  // its needRefresh/updateServiceWorker hooks — version.json owns detection, and
  // applyUpdate() drives activation directly so it can guarantee a reload.
  useRegisterSW({ immediate: true });

  void checkVersion(); // first check shortly after boot
  window.setInterval(() => void checkVersion(), CHECK_INTERVAL_MS);

  // The mobile gap: a backgrounded tab keeps serving the old build until
  // something forces a re-check. Re-check whenever the tab returns to the front.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void checkVersion();
  });
  window.addEventListener("focus", () => void checkVersion());
}

async function checkVersion(): Promise<void> {
  try {
    const res = await fetch(VERSION_URL, { cache: "no-store" });
    if (!res.ok) return;
    const remote = (await res.json()) as RemoteVersion;
    const verdict = evaluateVersion(LOCAL_VERSION, remote);
    updateAvailable.value = verdict.updateAvailable;
    updateRequired.value = verdict.critical;
  } catch {
    // Offline, blocked, or version.json not deployed yet — ignore and retry on
    // the next tick. An update check must never surface an error to the user.
  }
}

/**
 * Move to the newest build now, in the foreground, by an explicit user tap.
 * Guarantees forward progress: whatever the service worker does (or doesn't),
 * the page reloads — so the button can never spin forever.
 */
async function applyUpdate(): Promise<void> {
  if (applying.value) return;
  applying.value = true;

  // Failsafe: no matter which path below stalls (a worker that never takes
  // control, a slow cache wipe), we still reload within a few seconds. This is
  // what kills the "spinner hangs forever" bug.
  window.setTimeout(() => window.location.reload(), RELOAD_FAILSAFE_MS);

  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.waiting) {
      // A new worker is ready: ask it to take over, reload when it does. The
      // vite-plugin-pwa service worker handles this SKIP_WAITING message.
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => window.location.reload(),
        { once: true },
      );
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
      return; // controllerchange (or the failsafe) reloads us
    }
    // No worker waiting but version.json says we're behind → the SW precache is
    // serving a stale shell. Drop every SW + cache so the reload refetches the
    // no-cache index.html (and fresh hashed assets) from the network.
    await hardReset();
  } catch {
    window.location.reload();
  }
}

async function hardReset(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* ignore */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
  window.location.reload();
}
