import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `virtual:pwa-register/vue` is stubbed by a small plugin in vitest.config.ts so
// useAppUpdate can boot in the test runner without the real PWA plugin.
//
// These tests guard the "press Update → reloads → banner comes straight back"
// loop. The fix: every *guaranteed* path (the failsafe, and the no-worker-waiting
// recovery) must go through hardReset() — unregister the worker + drop its caches
// so the reload is forced onto the network — instead of a bare reload, which the
// still-controlling old worker would just re-serve the stale shell to.

type WaitingWorker = { postMessage: ReturnType<typeof vi.fn> };

function installServiceWorker(opts: { waiting: boolean }) {
  const waiting: WaitingWorker | null = opts.waiting ? { postMessage: vi.fn() } : null;
  const unregister = vi.fn().mockResolvedValue(true);
  const reg = { waiting, unregister };
  const listeners: Record<string, Array<() => void>> = {};
  const serviceWorker = {
    getRegistration: vi.fn().mockResolvedValue(reg),
    getRegistrations: vi.fn().mockResolvedValue([reg]),
    addEventListener: vi.fn((type: string, cb: () => void) => {
      (listeners[type] ||= []).push(cb);
    }),
  };
  Object.defineProperty(navigator, "serviceWorker", { value: serviceWorker, configurable: true });
  return { reg, waiting, unregister, listeners };
}

function installCaches() {
  const del = vi.fn().mockResolvedValue(true);
  const caches = { keys: vi.fn().mockResolvedValue(["precache-v1", "firebase-storage"]), delete: del };
  Object.defineProperty(globalThis, "caches", { value: caches, configurable: true });
  return { del };
}

function stubReload() {
  const reload = vi.fn();
  Object.defineProperty(window.location, "reload", { value: reload, configurable: true, writable: true });
  return reload;
}

describe("useAppUpdate › applyUpdate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    // checkVersion() runs on boot; reject the fetch so it no-ops in tests.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hard-resets (drops worker + caches) when no new worker is waiting", async () => {
    const { unregister } = installServiceWorker({ waiting: false });
    const { del } = installCaches();
    const reload = stubReload();

    const { useAppUpdate } = await import("./useAppUpdate");
    await useAppUpdate().applyUpdate();

    expect(unregister).toHaveBeenCalled();
    expect(del).toHaveBeenCalledTimes(2); // every cache dropped → reload hits the network
    expect(reload).toHaveBeenCalled();
  });

  it("reloads promptly via controllerchange when the new worker takes control", async () => {
    const { waiting, listeners } = installServiceWorker({ waiting: true });
    const { del } = installCaches();
    const reload = stubReload();

    const { useAppUpdate } = await import("./useAppUpdate");
    await useAppUpdate().applyUpdate();

    expect(waiting?.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    listeners["controllerchange"]?.forEach((cb) => cb()); // new worker claims the page
    expect(reload).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled(); // fast path: no cache nuke needed
  });

  it("falls back to a hard reset via the failsafe if controllerchange never fires", async () => {
    installServiceWorker({ waiting: true });
    const { del } = installCaches();
    const reload = stubReload();

    const { useAppUpdate } = await import("./useAppUpdate");
    await useAppUpdate().applyUpdate();

    expect(reload).not.toHaveBeenCalled(); // still waiting on controllerchange
    await vi.advanceTimersByTimeAsync(2500); // failsafe fires

    expect(del).toHaveBeenCalled(); // proof it's hardReset, not a bare reload
    expect(reload).toHaveBeenCalled();
  });
});
