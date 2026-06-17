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

---

## Run log
- Phase 0 harness + smoke: **GREEN** — both accounts sign in; `clientqa` = client only;
  `tradieqa` = tradesperson + admin + qa; tradie provisions via `/qa`; `/dashboard/tradie` renders
  after provisioning. (Confirmed the un-provisioned tradie correctly redirects to `/onboarding` —
  not a bug.)
- Phase 1 flagship leg 1 (client posts → tradie sees on board): **GREEN, 0 errors.** Notes (not
  bugs): every trade carries a required intake questionnaire (driver fills it generically) and
  budget is required; Firestore `Listen/channel` `ERR_ABORTED` on navigation is benign listener
  teardown (filtered as noise). Built `helpers/jobs.ts` (postJob + generic fillIntake),
  `helpers/uploads.ts`, `helpers/walk.ts` (console/network capture + noise filter), and a reusable
  `_explore.spec.ts` to learn selectors from the rendered DOM.
