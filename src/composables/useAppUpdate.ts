import { onUnmounted, watch } from "vue";
import { useRegisterSW } from "virtual:pwa-register/vue";

/**
 * Keeps an installed / mobile PWA on the latest deploy without the user ever
 * having to clear their cache or hard-refresh — the long-standing pain where a
 * backgrounded app keeps serving the old build until it's manually reloaded.
 *
 * Two halves, both needed:
 *
 *   1. DETECT — `registerType: "prompt"` (vite.config.ts) makes a new service
 *      worker *wait* rather than reload the tab itself. The browser only
 *      re-checks for a new sw.js on a fresh navigation, which mobile rarely
 *      does (it resumes the app, it doesn't reload it). So we re-check at the
 *      moments that gap shows up: when the app is resumed from the background
 *      (visibilitychange → visible / window focus) and on an hourly timer.
 *
 *   2. APPLY — but only at a SAFE moment, so we never reload someone mid-typing
 *      in a job chat or intake form. "Safe" = the app is backgrounded (the
 *      reload happens off-screen, zero interruption) OR the user has been idle
 *      for a few minutes. An update that isn't safe to apply yet stays pending
 *      and is applied at the next safe moment (background, or idle sweep).
 *
 * Call once, at the app root (App.vue).
 */

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // re-check for a new build hourly
const IDLE_BEFORE_RELOAD_MS = 3 * 60 * 1000; // "idle" = 3 min with no input
const PENDING_SWEEP_MS = 30 * 1000; // retry cadence for a deferred apply

export function useAppUpdate(): void {
  let registration: ServiceWorkerRegistration | undefined;
  let lastInteraction = performance.now();
  let applying = false;
  const timers: ReturnType<typeof setInterval>[] = [];

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, reg) {
      registration = reg;
    },
  });

  const isIdle = () => performance.now() - lastInteraction >= IDLE_BEFORE_RELOAD_MS;
  const isSafeToReload = () => document.hidden || isIdle();

  function applyIfSafe() {
    if (applying || !needRefresh.value || !isSafeToReload()) return;
    applying = true;
    // skipWaiting on the waiting SW, then reload once it takes control.
    void updateServiceWorker(true);
  }

  function checkForUpdate() {
    // Asks the browser to re-fetch sw.js and byte-compare it. If it changed,
    // the new worker installs and `needRefresh` flips → the watcher reacts.
    void registration?.update();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      // Backgrounding is the ideal moment to swap versions — apply now.
      applyIfSafe();
    } else {
      // Resumed: the mobile gap. Re-check for a fresh build.
      checkForUpdate();
    }
  }

  function markInteraction() {
    lastInteraction = performance.now();
  }

  // A new build became available → apply immediately if we're already idle or
  // backgrounded, otherwise it waits for the sweep or the next background.
  const stopWatch = watch(needRefresh, (available) => {
    if (available) applyIfSafe();
  });

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", checkForUpdate);
  window.addEventListener("pointerdown", markInteraction, { passive: true });
  window.addEventListener("keydown", markInteraction, { passive: true });

  timers.push(setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS));
  timers.push(setInterval(applyIfSafe, PENDING_SWEEP_MS));

  onUnmounted(() => {
    stopWatch();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", checkForUpdate);
    window.removeEventListener("pointerdown", markInteraction);
    window.removeEventListener("keydown", markInteraction);
    for (const timer of timers) clearInterval(timer);
  });
}
