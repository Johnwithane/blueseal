import { ref, watch, type Ref } from "vue";
import { useRegisterSW } from "virtual:pwa-register/vue";
import { evaluateVersion, type RemoteVersion } from "@/utils/appVersion";

/**
 * Keeps every Blue Seal client on the latest deploy — and gives the user a
 * visible way to update when the automatic path can't.
 *
 * The long-standing pain: a backgrounded/mobile-browser session keeps serving
 * the old build until it's manually hard-refreshed. The cache *headers* are
 * already correct (index.html / sw.js are `no-cache`), and a new service worker
 * IS detected — the failure is purely in *applying* it. The previous version
 * only ever applied silently at a "safe moment" (app backgrounded or idle),
 * which never arrives in an actively-used foreground browser tab; and when the
 * tab is backgrounded, mobile browsers freeze it before the off-screen reload
 * can finish. So it landed for installed apps but not browser tabs. This is the
 * exact gap Johnny hit.
 *
 * The fix is three parts, all owned here (a module-level singleton; call
 * `useAppUpdate()` once at the app root, then anywhere else for its state):
 *
 *   1. DETECT (two independent signals, belt and braces):
 *      - vite-plugin-pwa's `needRefresh` — flips when a new SW is waiting.
 *      - a poll of `/version.json` — a tiny, network-only manifest (no service
 *        worker involved, so it's reliable even when the SW is wedged) that also
 *        carries a `critical` flag for forced updates. Re-checked on resume
 *        (visibilitychange/focus) and on a timer.
 *
 *   2. SURFACE — `updateAvailable` drives a visible "Update" banner the user can
 *      tap (AppUpdatePrompt.vue). `updateRequired` (a critical release) drives a
 *      blocking "Update required" overlay so a known-dangerous build can't keep
 *      being used. The tap applies the update in the foreground, by a real user
 *      gesture — which sidesteps the frozen-tab problem entirely.
 *
 *   3. AUTO-APPLY (bonus) — still silently swaps versions when it WON'T interrupt
 *      anyone (app backgrounded, or idle a few minutes). Installed PWAs hit this
 *      constantly and self-heal with zero friction; browser tabs fall back to the
 *      banner.
 */

// Build id baked in at compile time by vite's `define` (see vite.config.ts).
// `typeof` guard so unit tests / any context where `define` isn't applied don't
// throw a ReferenceError — they just read "dev" and never prompt.
const LOCAL_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

const VERSION_URL = "/version.json";
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // backstop re-check every 30 min
const IDLE_BEFORE_RELOAD_MS = 3 * 60 * 1000; // "idle" = 3 min with no input
const PENDING_SWEEP_MS = 30 * 1000; // retry cadence for a deferred auto-apply

// ── singleton state, shared across every useAppUpdate() caller ───────────────
const updateAvailable = ref(false); // a newer build exists → show the banner
const updateRequired = ref(false); // newer build is critical → blocking overlay
const applying = ref(false); // an apply is in flight (button spinner)
let started = false;

// Service-worker handles, populated once the SW registers. applyUpdate() reads
// them; null until then (and in dev, where no SW is registered).
let registration: ServiceWorkerRegistration | undefined;
let swNeedRefresh: Ref<boolean> | null = null;
let swUpdate: ((reload?: boolean) => Promise<void>) | null = null;

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
  let lastInteraction = performance.now();

  const reg = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, r) {
      registration = r;
    },
  });
  swNeedRefresh = reg.needRefresh;
  swUpdate = reg.updateServiceWorker;

  // A waiting SW is itself a "new build available" signal — mirror it so the
  // banner shows even before the version.json poll has run.
  watch(reg.needRefresh, (waiting) => {
    if (waiting) updateAvailable.value = true;
  });

  const isIdle = () => performance.now() - lastInteraction >= IDLE_BEFORE_RELOAD_MS;
  const isSafeToReload = () => document.hidden || isIdle();

  async function checkVersion() {
    try {
      const res = await fetch(VERSION_URL, { cache: "no-store" });
      if (!res.ok) return;
      const remote = (await res.json()) as RemoteVersion;
      const verdict = evaluateVersion(LOCAL_VERSION, remote);
      if (verdict.updateAvailable) updateAvailable.value = true;
      if (verdict.critical) updateRequired.value = true;
    } catch {
      // Offline, blocked, or version.json not deployed yet — ignore and retry
      // on the next tick. Never let an update check surface an error to the user.
    }
  }

  function checkForUpdate() {
    void registration?.update(); // re-fetch sw.js + byte-compare
    void checkVersion();
  }

  // Silent auto-apply, but only when it won't yank the page out from under
  // someone (backgrounded, or idle). A critical update self-heals here too.
  function autoApplyIfSafe() {
    if (applying.value) return;
    if (!updateAvailable.value && !updateRequired.value) return;
    if (!isSafeToReload()) return;
    void applyUpdate();
  }

  function onVisibilityChange() {
    if (document.hidden) autoApplyIfSafe(); // ideal moment to swap, off-screen
    else checkForUpdate(); // resumed → re-check (the mobile gap)
  }
  function markInteraction() {
    lastInteraction = performance.now();
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", checkForUpdate);
  window.addEventListener("pointerdown", markInteraction, { passive: true });
  window.addEventListener("keydown", markInteraction, { passive: true });

  // Singleton lives for the app's lifetime, so these timers never need clearing.
  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
  setInterval(autoApplyIfSafe, PENDING_SWEEP_MS);

  void checkVersion(); // first check shortly after boot
}

/**
 * Apply the pending update now, in the foreground. Triggered by the user tapping
 * "Update" (or by the safe-moment auto-apply). Navigates the page, so anything
 * after the reload won't run.
 */
async function applyUpdate(): Promise<void> {
  if (applying.value) return;
  applying.value = true;
  try {
    // Make sure we've fetched the freshest sw.js and, if it changed, it's waiting.
    try {
      await registration?.update();
    } catch {
      /* ignore — fall through to the checks below */
    }

    // Clean path: a worker is waiting → skip-waiting + reload via the plugin.
    if (registration?.waiting || swNeedRefresh?.value) {
      await swUpdate?.(true); // reloads on controllerchange; code below won't run
      return;
    }

    // Fallback: no waiting worker (SW unsupported, or wedged on a stale
    // precache). Drop every SW + cache and hard-reload so the no-cache shell and
    // sw.js are refetched from the network — the bulletproof "get unstuck" path.
    await hardReset();
  } finally {
    applying.value = false;
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
