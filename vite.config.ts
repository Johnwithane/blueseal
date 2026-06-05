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
        "favicon.ico",
        "favicon-16x16.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "robots.txt",
        "icons/blueseal_logoCircle.png",
        "icons/blueseal_logo_Character.png",
      ],
      manifest: {
        name: "Blue Seal",
        short_name: "BlueSeal",
        description: "Verified tradespeople, real reviews, AI-powered job tools.",
        theme_color: "#0d47a1",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        // These must point at files that exist in public/ — the previous
        // android-chrome-* paths 404'd, so the install prompt had no icon.
        icons: [
          { src: "/android-icon-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/blueseal_logoCircle.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
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
