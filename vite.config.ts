import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
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
        // `id` pins the app's identity across origin/start_url changes — without
        // it, Play (TWA) and browsers can treat a moved start_url as a new app.
        id: "/",
        name: "Blue Seal",
        short_name: "BlueSeal",
        description: "Verified tradespeople, real reviews, AI-powered job tools.",
        theme_color: "#374C76",
        background_color: "#FAF9F6",
        display: "standalone",
        start_url: "/",
        scope: "/",
        lang: "en-CA",
        dir: "ltr",
        orientation: "portrait",
        // Used by Play Store listing categorisation when wrapped as a TWA.
        categories: ["business", "productivity", "utilities"],
        // These must point at files that exist in public/ — the previous
        // android-chrome-* paths 404'd, so the install prompt had no icon.
        // A `maskable` icon (cream safe-zone padding, see scripts) is required
        // for clean Android adaptive icons and the TWA launcher icon.
        icons: [
          { src: "/android-icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          {
            src: "/icons/blueseal_logoCircle_RED.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The FCM service worker registers itself (separate scope) — keep it
        // out of the precache so Workbox never serves a stale copy of it.
        globIgnores: ["firebase-messaging-sw.js"],
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
