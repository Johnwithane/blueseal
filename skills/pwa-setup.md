# PWA setup

How to make a web app installable — the "Install Blue Seal" button you see in Chrome's address bar, and the matching "Add to Home Screen" on phones. Drop-in pattern for Vite + Vue, but the platform notes apply to any web app.

This skill is also a reference you can lift into other projects (Next.js, vanilla, etc.) — the platform behavior is the same; only the build wiring differs.

---

## The three things a browser needs to offer Install

Browsers (Chrome, Edge, Brave, Samsung Internet, Android Chrome) auto-show an install affordance once **all three** of these are present. Miss any one and the prompt silently doesn't appear.

1. **A web app manifest** — a JSON file at `/manifest.webmanifest` describing the app (name, icons, colors, start URL).
2. **A registered service worker** — even a near-empty one. Just having one running counts.
3. **HTTPS** — required. Firebase Hosting, Vercel, Netlify, Cloudflare Pages all give you this for free. `localhost` also counts during dev.

There is no "install button" in your code. The browser draws it. Your job is just to satisfy the three preconditions.

---

## Blue Seal's wiring (the reference example)

Three files, that's it:

| File | What it does |
| --- | --- |
| [vite.config.ts](../vite.config.ts#L11-L54) | `VitePWA({...})` plugin generates the manifest + service worker at build time |
| [index.html](../index.html#L15) | `<link rel="manifest" href="/manifest.webmanifest" />` + `<meta name="theme-color">` |
| `public/android-chrome-{192,512}.png` etc. | The icons the manifest references — must exist at the paths declared |

The `VitePWA` config sets `registerType: "autoUpdate"`, so the service worker also self-updates when you ship — users don't have to reinstall to get new code.

---

## Doing it in a new Vite project (Vue / React / Svelte / vanilla)

```bash
npm i -D vite-plugin-pwa
```

Then in `vite.config.ts`:

```ts
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "My App",
        short_name: "MyApp",
        description: "What the app does.",
        theme_color: "#0d47a1",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
```

In `index.html` `<head>`:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#0d47a1" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

Drop a 192×192 and 512×512 PNG into `public/`. Done. `npm run dev` → open in Chrome → install icon appears in the address bar.

**Generate the icon set** at [realfavicongenerator.net](https://realfavicongenerator.net) — upload one square PNG (1024×1024+), it spits out every size + the `<link>` tags.

### Other frameworks

- **Next.js**: `npm i @ducanh2912/next-pwa`, put `manifest.json` in `/public`, follow the plugin's `next.config.js` snippet.
- **SvelteKit**: `@vite-pwa/sveltekit` — same `VitePWA(...)` config as above.
- **Vanilla / no framework**: write `manifest.webmanifest` by hand, link it from `<head>`, register any service worker (`navigator.serviceWorker.register('/sw.js')`), serve over HTTPS.

---

## Platform-by-platform install behavior

This is the part most tutorials get wrong. Reality is messy because Apple.

### Desktop Chromium (Chrome, Edge, Brave, Opera)
- Install icon appears in the address bar once preconditions met
- Three-dot menu also has "Install <app>"
- `beforeinstallprompt` event fires → you can build a custom in-app install button (see below)

### Desktop Safari (macOS 14+)
- Share menu → "Add to Dock"
- No `beforeinstallprompt` event — no programmatic prompt

### Desktop Firefox
- Does **not** install PWAs at all on desktop. There's an extension ("PWAs for Firefox") but no built-in support. Treat as not-installable.

### Android Chrome / Samsung Internet / Edge
- Auto-shows an "Add to Home Screen" banner after some engagement heuristic
- Three-dot menu → "Install app" or "Add to Home Screen"
- `beforeinstallprompt` event fires — same custom-button path as desktop
- Installs as a real app with its own icon in the launcher, separate task in the recents view

### iOS Safari (the awkward one)
- **No install button. Ever.** Apple does not let websites trigger or offer installation.
- User must tap the Share icon → scroll down → "Add to Home Screen"
- Reads your manifest for the icon/name/colors once installed
- `display: standalone` works — strips the Safari chrome when launched from home screen
- `beforeinstallprompt` does **not** fire on iOS

### iOS Chrome / Firefox / Edge / Brave
- All forced to use Safari's WebKit engine (App Store policy)
- Chrome iOS has its own "Add to Home Screen" in the share menu — but historically it added a Chrome shortcut, not a true standalone PWA. Improved in recent versions; still inconsistent.
- **Tell iOS users to use Safari** if you want reliable PWA behavior. It's the only path that's guaranteed to work.

### iOS PWA limitations worth flagging to users
- No web push notifications until iOS 16.4 (March 2023), and even then **only for installed PWAs**, not Safari tabs
- Storage can be evicted if app unused for ~7 days (better in iOS 17+, still not guaranteed)
- No background sync
- Camera/file picker more restricted than Android

---

## Building an in-app install button (Chromium only)

You can capture the install prompt and trigger it from your own UI. This is the pattern for an "Install our app" button inside your site.

```ts
// composables/useInstallPrompt.ts (or equivalent)
import { ref, onMounted } from "vue";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function useInstallPrompt() {
  const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null);
  const canInstall = ref(false);
  const isInstalled = ref(false);

  onMounted(() => {
    // Detect "already running as installed PWA"
    isInstalled.value =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS-specific: window.navigator.standalone is true when launched from home screen
      (window.navigator as { standalone?: boolean }).standalone === true;

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt.value = e as BeforeInstallPromptEvent;
      canInstall.value = true;
    });

    window.addEventListener("appinstalled", () => {
      isInstalled.value = true;
      canInstall.value = false;
      deferredPrompt.value = null;
    });
  });

  async function promptInstall() {
    if (!deferredPrompt.value) return;
    await deferredPrompt.value.prompt();
    const { outcome } = await deferredPrompt.value.userChoice;
    deferredPrompt.value = null;
    canInstall.value = false;
    return outcome; // "accepted" or "dismissed"
  }

  return { canInstall, isInstalled, promptInstall };
}
```

Used in a component:

```vue
<script setup lang="ts">
import { useInstallPrompt } from "@/composables/useInstallPrompt";
const { canInstall, isInstalled, promptInstall } = useInstallPrompt();
</script>

<template>
  <Button v-if="canInstall && !isInstalled" @click="promptInstall" label="Install app" />
</template>
```

**Important constraint:** `prompt()` must be called from a user-gesture handler (click/tap). You cannot auto-fire it on page load.

### Detecting iOS to show manual instructions

Since iOS doesn't fire `beforeinstallprompt`, you have to detect iOS Safari and show a "Tap Share → Add to Home Screen" hint yourself:

```ts
function isIos(): boolean {
  // Includes iPad on iOS 13+ (which reports as Mac)
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes("Mac") && "ontouchend" in document);
}

function isInStandaloneMode(): boolean {
  return (navigator as { standalone?: boolean }).standalone === true;
}

// Show the instruction card when:
//   isIos() && !isInStandaloneMode()
```

A nice UX: small dismissible banner with an arrow pointing toward the Safari share button, saying "Install Blue Seal: tap [share-icon] then 'Add to Home Screen'." Only show it once per user (localStorage flag) and only on Safari iOS.

---

## Common gotchas

- **Icons must be PNG, not SVG.** Chrome silently refuses the install prompt if any declared icon 404s or is the wrong format.
- **Both 192 and 512 are required.** Don't skip 512 — Android needs it for the splash screen.
- **`start_url` matters.** If your app uses Vue Router with subpaths and you set `start_url: "/dashboard"`, the install heuristic counts engagement on that URL specifically. Default to `"/"` unless you have a reason.
- **Service worker scope.** A service worker at `/sw.js` controls everything under `/`. If you put it deeper (`/app/sw.js`), it only controls `/app/...`. `vite-plugin-pwa` handles this correctly by default.
- **Cache + stale assets (the "I don't see my deploy until I hard-refresh" bug).** `registerType: "autoUpdate"` only re-checks for a new `sw.js` on a fresh *navigation*. Desktop reloads tabs constantly so it's invisible there — but mobile (and installed PWAs) *resume* the app instead of reloading, so the check never fires and the user is stuck on the old build until they manually clear cache. Blue Seal fixes this in [`src/composables/useAppUpdate.ts`](../src/composables/useAppUpdate.ts): config is `registerType: "prompt"` so a new worker *waits*, and the composable (a) re-checks on resume (`visibilitychange`/`focus`) + hourly, then (b) applies the update only at a safe moment — app backgrounded or user idle — so it never reloads someone mid-form. Wired in once at the app root ([App.vue](../src/App.vue)). NB: the cache *headers* must also be right — `index.html` and `sw.js` need `Cache-Control: no-cache` ([firebase.json](../firebase.json)) or the browser never even fetches the new worker to compare it.
- **Firebase Hosting reserved paths.** If you use Workbox's `navigateFallback`, add `navigateFallbackDenylist: [/^\/__\//]` so Firebase's `/__/auth/*` and `/__/firebase/*` endpoints hit the network instead of the cached shell. (See [vite.config.ts:42](../vite.config.ts#L42) for the live example.)
- **Manifest edits don't always re-prompt.** If a user already dismissed the install prompt, changing the manifest doesn't bring it back. Chrome has a ~90-day cooldown per origin.

---

## Verifying it works

1. **Chrome DevTools → Application tab → Manifest** — shows your parsed manifest, flags errors (missing icons, wrong sizes, bad colors).
2. **Application tab → Service Workers** — confirm one is registered and "activated".
3. **Lighthouse → PWA category** — runs all the install criteria as a checklist. Should score 100/100 for "Installable."
4. **Real-device test:**
   - Android: open in Chrome, look for the install banner or three-dot menu item
   - iPhone: open in Safari, Share → "Add to Home Screen" should show your icon + name
   - Desktop: install icon should appear in the Chrome/Edge address bar
