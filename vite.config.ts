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
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.ico",
        "favicon-16x16.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "robots.txt",
        "icons/blueseal_logo.png",
      ],
      manifest: {
        name: "Blue Seal",
        short_name: "BlueSeal",
        description: "Verified tradespeople, real reviews, AI-powered job tools.",
        theme_color: "#0d47a1",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
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
