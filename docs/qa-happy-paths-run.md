# QA happy-paths run — findings

Autonomous walk → discover → log → fix of the happy paths (`docs/QA_HAPPY_PATHS.md`), driven by
the headless Playwright harness in `e2e/happy-paths/` against the deployed **test-mode** site
(`https://blueseal-762af.web.app`), signed in as `clientqa@` (client) and `tradieqa@`
(tradesperson + admin + qa).

Status legend: **open** → **fixed** (code changed, not yet re-verified in browser) → **verified**
(driver re-run clean).

## Top to fix first

1. _(none critical yet — run in progress)_

## Critical
_none yet_

## High
_none yet_

## Medium
_none yet_

## Low

### L2 — Address fields use the deprecated `google.maps.places.Autocomplete` API — **open**
- **Where:** any address field (Account → location, /jobs/post, /request, onboarding) — 2 console
  warnings per page that loads Maps.
- **Evidence:** `google.maps.places.Autocomplete` is "not available to new customers" as of
  2025-03-01; Google recommends `PlaceAutocompleteElement`. Still works (bug-fixed, ≥12 months
  notice before any removal), so this is **tech debt / future-proofing**, not a break.
- **Fix (deferred):** migrate `useGoogleMaps` (`src/composables/useGoogleMaps.ts`) + the address
  fields to `PlaceAutocompleteElement`. Non-trivial (touches every address input) — flagged for a
  deliberate change, not a mid-QA hotfix.

### L1 — CSP blocks Google Analytics (`www.google.com`) on every page — **verified**
- Re-run after the hosting deploy: console errors went **4/11 → 0/0** on both accounts.
- **Where:** every page; console on load.
- **Evidence:** GA4 attempts `connect`/`fetch` to `https://www.google.com/g/collect…` and an
  `img` load of `https://www.google.com/images/cleardot.gif`, both blocked by the
  `Content-Security-Policy` (`connect-src`/`img-src` whitelist `*.google-analytics.com` +
  `googletagmanager.com` but **not** `www.google.com`). ~4–11 console errors per session.
- **Impact:** low — core GA still works via `www.google-analytics.com`; the blocked hits are
  GA4 signals/`cleardot`. No user-facing breakage, but persistent console noise.
- **Root cause:** the GA allowlist in `firebase.json` CSP omitted `www.google.com`.
- **Fix:** added `https://www.google.com` to `connect-src` + `img-src` in `firebase.json`.
  Pending a hosting deploy to take effect. (Alternative considered: disable GA signals instead of
  loosening CSP — rejected as more invasive given GA is already intentionally enabled.)

## Untested / deferred
- Email-link flows (invite-claim, prospect-claim, password reset) — need an inbox; deferred.
- **AI Pro paywall** — both test accounts bypass it (`tradieqa` is admin → exempt; `clientqa` is
  client → no AI). Verifying the not-Pro → `BLUESEAL_PRO_REQUIRED` → paywall popup needs a plain
  non-admin tradesperson (or temporarily removing admin from `tradieqa`). The AI assistant itself
  works (real Vertex response, well-formatted).

---

## Run log
- Phase 0 harness + smoke: **GREEN** — both accounts sign in; `clientqa` = client only;
  `tradieqa` = tradesperson + admin + qa; tradie provisions via `/qa`; `/dashboard/tradie` renders
  after provisioning. (Confirmed the un-provisioned tradie correctly redirects to `/onboarding` —
  not a bug.)
- **Interactive live sweep (Playwright MCP, as `tradieqa`):** sign-in ✓, tradie dashboard ✓
  (0 errors), AI assistant ✓ (real response), admin dashboard ✓, admin user search + the inline
  roles editor ✓, and the **user detail panel loads instantly** (verifies the reactivity fix on the
  live site — no more "Loading details…" hang). New finding: L2 (deprecated Maps Autocomplete).
  App is polished; few defects surfaced. (Minor: sign-in briefly lands on `/` before
  `/dashboard/tradie` — cosmetic, not pursued.)
- **Live onboarding → vetting (interactive, end-to-end): GREEN, 0 console errors.** Signed up a
  brand-new tradesperson (`qatradie2@blueseal.app`, "Quinn QA Painter") and walked all 7 wizard
  steps — Basics, Trades (Painter), Pricing ($75/hr), Area (Kelowna via Google Places, map
  centered correctly), Hours, **Documents (uploaded a photo ID + a Red Seal cert, both accepted →
  "In review")**, Review → **Submit for review**. Dashboard correctly showed "Application under
  review". Then as admin (`tradieqa`) → `/admin/vetting` → the application appeared → review page
  showed profile/cert/ID with verify-helper links → **"Approve everything"** → queue clear, profile
  live. Flawless.
- **AI Pro paywall verified (gap closed):** as the new non-Pro, non-admin tradesperson (Quinn), the
  AI assistant shows the **"Blue Seal AI is part of Pro"** upgrade screen (Start 30-day trial +
  "Receipt scanning stays free") instead of the chat. With an entitled account (admin) the AI
  returns a real answer. Paywall behaves correctly both ways.
- Phase 1 flagship leg 1 (client posts → tradie sees on board): **GREEN, 0 errors.** Notes (not
  bugs): every trade carries a required intake questionnaire (driver fills it generically) and
  budget is required; Firestore `Listen/channel` `ERR_ABORTED` on navigation is benign listener
  teardown (filtered as noise). Built `helpers/jobs.ts` (postJob + generic fillIntake),
  `helpers/uploads.ts`, `helpers/walk.ts` (console/network capture + noise filter), and a reusable
  `_explore.spec.ts` to learn selectors from the rendered DOM.
