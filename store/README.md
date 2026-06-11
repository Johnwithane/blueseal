# Store distribution

Blue Seal stays a **PWA at its core**. The stores get a thin wrapper around the
same web build (`dist/`) — there is no second codebase, no native UI to maintain.

| Store | Mechanism | Lives in | Build machine |
| --- | --- | --- | --- |
| **Google Play** | Trusted Web Activity (TWA) via Bubblewrap | `store/twa-manifest.json` + `public/.well-known/assetlinks.json` | Any (Linux/Mac/Win + JDK + Android SDK) |
| **Apple App Store** | Capacitor native shell | `capacitor.config.ts` → generated `ios/` | **macOS + Xcode only** |

> The account creation, signing keys, fingerprints, store listings and the
> actual submissions are human-gated. The full step-by-step runbook is in
> [`HUMANTASKS.md`](../HUMANTASKS.md) → **"App Store + Google Play distribution"**.
> This file is just the developer cheat-sheet for the local mechanics.

---

## Google Play (TWA)

The PWA itself is already store-ready (installable manifest + service worker).
A TWA is a launcher that opens `https://blueseal.app` full-screen, with no
browser chrome, verified by Digital Asset Links so the URL bar never shows.

**One-time, on a build machine:**

```bash
npm i -g @bubblewrap/cli      # needs JDK 17 + Android SDK (Bubblewrap can install them)
cd store
bubblewrap init --manifest ./twa-manifest.json   # or `bubblewrap update` after edits
bubblewrap build              # produces app-release-bundle.aab + signing key
```

**Then, to make the URL-bar disappear (asset-link verification):**

1. `bubblewrap build` prints the **SHA-256 fingerprint** of your signing key.
   After you upload to Play and enrol in **Play App Signing**, Play re-signs the
   app — copy the SHA-256 from **Play Console → Setup → App integrity → App
   signing key certificate** (NOT the local upload key).
2. Paste that fingerprint into `public/.well-known/assetlinks.json`
   (`sha256_cert_fingerprints`), replacing `REPLACE_WITH_SHA256_FROM_PLAY_APP_SIGNING`.
3. `npm run deploy:hosting` so `https://blueseal.app/.well-known/assetlinks.json`
   is live. Verify it returns the JSON and `Content-Type: application/json`.
4. Upload the `.aab` to a Play **internal testing** track and install — the URL
   bar should be gone. If it isn't, asset links aren't matching (wrong package
   name or fingerprint).

`twa-manifest.json` already targets `host: blueseal.app`,
`webManifestUrl: /manifest.webmanifest`, brand colors and the maskable icon —
re-run `bubblewrap update` whenever those change.

---

## Apple App Store (Capacitor)

Apple rejects thin webview wrappers (Guideline 4.2), so iOS is a real Capacitor
native container around the same `dist/` build.

**On a Mac with Xcode + CocoaPods:**

```bash
npm install
npm run build            # produce dist/
npx cap add ios          # one-time: generates the ios/ project (not committed)
npm run cap:ios          # build + sync + open Xcode
```

Then in Xcode: set the team/bundle id (`app.blueseal`), version, signing, and
Archive → upload to App Store Connect. See HUMANTASKS for the Firebase Auth
authorized-domain step (sign-in breaks in the shell without it).

> `ios/` and `android/` are **git-ignored** — they're generated artifacts, and
> the iOS one can only be built/verified on a Mac. Regenerate with `cap add`.
