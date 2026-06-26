import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

// Build id baked into the app (__APP_VERSION__) and written to /version.json, so
// a running client can tell when a newer build has shipped. The git short SHA
// maps a build to an exact commit; fall back to a timestamp when git isn't
// available (e.g. a shallow CI checkout with no history).
function resolveBuildId(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return `t${Date.now()}`;
  }
}
const BUILD_ID = resolveBuildId();

// Set CRITICAL_RELEASE=1 on the build that ships an urgent fix (e.g.
// `CRITICAL_RELEASE=1 npm run deploy:prod`) → version.json carries critical:true,
// so any client still on an older build is force-updated via a blocking overlay
// instead of a dismissable banner. A normal deploy leaves it false.
const CRITICAL_RELEASE = process.env.CRITICAL_RELEASE === "1";

// Emits dist/version.json — a tiny, always-network-fetched manifest the running
// app polls (independent of the service worker, so it works even when the SW is
// wedged) to learn a newer build shipped. Kept out of the Workbox precache (see
// globIgnores) and served `no-cache` (firebase.json) so it's never stale.
function versionManifest(): Plugin {
  return {
    name: "blueseal-version-manifest",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: BUILD_ID, critical: CRITICAL_RELEASE }) + "\n",
      });
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    vue(),
    tailwindcss(),
    versionManifest(),
    VitePWA({
      // "prompt" (not "autoUpdate") so a freshly-deployed service worker WAITS
      // instead of force-reloading the tab. useAppUpdate() (src/composables)
      // owns the decision of *when* to apply it — only at a safe, non-disruptive
      // moment — which is what fixes "I don't see updates until I hard-refresh"
      // on mobile without yanking the page out from under someone mid-form.
      registerType: "prompt",
      includeAssets: [
        "faviconBS.ico",
        "faviconBS-16x16.png",
        "faviconBS-32x32.png",
        "apple-touch-icon.png",
        "robots.txt",
        "icons/blueseal_logoCircle_RED.png",
        "icons/blueseal_logo_Character.png",
      ],
      manifest: {
        name: "Blue Seal",
        short_name: "BlueSeal",
        description: "Verified tradespeople, real reviews, AI-powered job tools.",
        theme_color: "#374C76",
        background_color: "#FAF9F6",
        display: "standalone",
        start_url: "/",
        // These must point at files that exist in public/ — the previous
        // android-chrome-* paths 404'd, so the install prompt had no icon.
        icons: [
          { src: "/android-icon-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/blueseal_logoCircle_RED.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // When useAppUpdate() skip-waits the new worker, claim the open page so
        // `controllerchange` fires and we reload onto the fresh build promptly.
        // Without this the apply leans entirely on its hardReset failsafe — the
        // update still lands, just a couple seconds slower and via a cache wipe.
        clientsClaim: true,
        // The FCM service worker registers itself (separate scope) — keep it
        // out of the precache so Workbox never serves a stale copy of it.
        // version.json MUST always hit the network (it's the freshness probe),
        // so keep it out of the precache too.
        globIgnores: ["firebase-messaging-sw.js", "version.json"],
        // SPA navigation: serve the cached app shell for any client-side route
        // so Vue Router can resolve it. Do NOT point this at /offline.html —
        // that swallows every direct navigation (e.g. /onboarding) and shows
        // the offline page even when the user is online. A real offline
        // fallback needs a custom SW (injectManifest + setCatchHandler).
        navigateFallback: "/index.html",
        // Firebase Hosting reserved paths must hit the network, not the shell.
        navigateFallbackDenylist: [/^\/__\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "firebase-storage",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
