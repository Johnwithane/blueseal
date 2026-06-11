import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor wraps the built PWA (dist/) in a native shell. This is the path to
// the **iOS App Store** — Apple rejects thin "website in a webview" apps
// (Guideline 4.2), so the iOS build is a real native container around our web
// assets. Android ships to Google Play via a TWA instead (see store/), not via
// this config — but the android platform is kept available if we ever switch.
//
// We bundle the web assets (webDir) rather than pointing server.url at the live
// site: it works offline, passes store review more cleanly, and pins the binary
// to a known-good build. Re-run `npm run cap:sync` after every `npm run build`.
//
// NOTE on Firebase Auth: bundled assets run on the capacitor:// (iOS) /
// https://localhost (Android) scheme, not blueseal.app. The Firebase Auth
// authorized-domains list and any OAuth redirect URIs must include those
// schemes or sign-in popups/redirects fail in the shell. See
// HUMANTASKS.md → "App Store + Google Play distribution".
const config: CapacitorConfig = {
  appId: "app.blueseal",
  appName: "Blue Seal",
  webDir: "dist",
  // Splash/scheme niceties live in the native projects once `cap add` is run on
  // a build machine; keep this config minimal and let the platform defaults win.
  ios: {
    // Inset content below the notch / dynamic island (matches viewport-fit=cover).
    contentInset: "always",
  },
};

export default config;
