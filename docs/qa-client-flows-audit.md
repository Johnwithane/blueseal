# QA audit — client flows + public/hybrid sweep

Exploratory Playwright MCP run against the local emulator suite (Auth 9099, Firestore 8080,
Functions 5001, Storage 9199) + Vite dev server (`http://localhost:5173`,
`VITE_USE_EMULATORS=true`), per `docs/QA_PLAYWRIGHT.md`. Firebase project `blueseal-762af`.

**Scope:** signed-out public/hybrid route sweep (375×667, spot-checked 1440×900) + the client
journey as a plain `client`-role account (post a job → view post → cancel → dashboard → account).
Tradesperson/admin/PM-side flows (quotes, chat, invoices, kanban) are explicitly **out of scope**
for this run.

**Accounts seeded:**
- `qa-admin@blueseal.test` / `QaPass!2026` — all roles (client/tradesperson/admin). Signup via the
  UI failed (see CRIT-1); roles were seeded directly via the Admin SDK against the local emulator
  only (see CRIT-1 for why, and why this doesn't invalidate the finding).
- `qa-client@blueseal.test` / `QaPass!2026` — plain client role, used for the client journey.
- `qa-tradie-rolecheck@blueseal.test` / `QaPass!2026` — throwaway account created solely to prove
  CRIT-1's role-corruption side effect; left as-is (emulator data, not production).

Emulator connection verified before any account creation: Auth traffic confirmed on
`localhost:9099/identitytoolkit.googleapis.com`, Firestore on `localhost:8080` (no
`*.googleapis.com` real-internet Auth/Firestore calls observed).

---

## Top 3 to fix first

1. **CRIT-1 — Every signup is broken** (`functions/src/auth/provisionAccount.ts`). Blocks/corrupts
   100% of new client, tradesperson, and project-manager signups (email/password and Google). One
   Zod schema tweak (`.nullable()` on 3 fields) fixes it.
2. **HIGH-1 — Cancelled job post is a dead-end** (`src/views/JobPostDetailView.vue:794`). Confirms
   the reporter's suspicion exactly: misleading "tradespeople are being notified" copy persists
   after cancellation, no follow-up CTA. One `v-else-if` branch fixes it (pattern already exists
   for the `closed` status two lines above).
3. **MED-1 — Post-sign-in redirect silently fails** (`src/router/index.ts` + `src/stores/auth.ts`).
   Hits **every single sign-in**, not an edge case — `auth.ready` is a one-shot latch that doesn't
   re-arm on a fresh sign-in, so the router guard races the async claims/doc load and drops users
   on the marketing homepage instead of their dashboard or the page they deep-linked to.

---

## Critical

### CRIT-1 — `provisionAccount` 400s on every signup; tradesperson/PM signups silently downgrade to client
- **Where:** `/sign-up`, `/sign-up?as=tradesperson`, `/sign-up?as=projectManager`, and the Google
  sign-in/signup path (`signInWithGoogle` calls the same callable on every popup completion, not
  just first-time).
- **Repro:** fill the sign-up form (any role) → Create account.
- **Observed:** Auth account IS created (`accounts:signUp`/`lookup`/`update` all 200), but
  `POST .../provisionAccount` returns **400** — network body:
  `{"error":{"message":"Invalid input","status":"INVALID_ARGUMENT"}}`. Request payload always
  includes `"referralCode":null,"referralSignal":null,"pmCode":null"` even when the user typed no
  referral code. The sign-up page shows a red "Invalid input" alert and **never redirects** —
  meanwhile the header silently flips to signed-in (Firebase Auth session is real).
- **Root cause:** `functions/src/auth/provisionAccount.ts` Zod schema declares
  `referralCode`/`referralSignal`/`pmCode` as `.optional()` **without** `.nullable()`. The client
  (`src/stores/auth.ts` `signUp()`/`signInWithGoogle()`) always includes these keys in the object
  literal even when unset (as `undefined`), and the Firebase Callable Functions client SDK
  serializes `undefined` object properties to explicit `null` on the wire — so `Input.safeParse`
  rejects the payload every time. The sibling `photoURL` field is correctly
  `.nullable().optional()` — the fix is a one-line pattern match onto the other three fields.
- **Masking side effect (worse than the visible bug):** `applyAuthState`'s orphan self-heal
  (`src/stores/auth.ts` ~L212) detects the missing `users/{uid}` doc on the next auth-state tick
  and silently retries `provisionAccount` with a **minimal payload and a hardcoded `role:
  "client"`**. For a **client** signup this happens to converge on the right state (confirmed:
  `qa-client`'s claims came back `{role:"client", roles:["client"]}`, matching intent). For a
  **tradesperson** signup it does not: live repro —
  1. Signed up `qa-tradie-rolecheck@blueseal.test` via `/sign-up?as=tradesperson`.
  2. `provisionAccount` 400s with `role:"tradesperson"` in the payload (correct role selected).
  3. Self-heal fires, re-calls `provisionAccount` with `role:"client"` (hardcoded) → 200.
  4. Navigated to `/onboarding` (tradesperson-only route) → **redirected to `/`** — proving the
     account is client-only. The user who explicitly chose "I'm a tradesperson" silently ends up
     as a plain client with zero on-screen indication anything went wrong.
- **Also confirms:** the QA runbook's documented seeding path (sign up → call
  `grantAllRolesForAdminTesting` on yourself) is currently unreachable even *without* this bug,
  because that callable requires the caller to already hold the `admin` claim (`requireAdmin`) —
  chicken-and-egg for a fresh account. Worth a doc note once CRIT-1 is fixed, since the two bugs
  compound (a fresh signup can't self-promote even after provisioning succeeds).
- **Fix direction:** add `.nullable()` to all three fields in `provisionAccount`'s `Input` schema
  (matches `photoURL`'s existing pattern). Consider also making the orphan self-heal role-aware
  (or at least logging loudly / surfacing a "we couldn't set your requested role, please contact
  support" banner) as defense in depth, since a similar future bug could reintroduce silent role
  corruption.

---

## High

### HIGH-1 — Cancelled job post: misleading "being notified" copy + no follow-up CTA
- **Where:** `/jobs/posted/:postId` after cancelling.
- **Repro:** as `qa-client`, post a job (Plumber, full wizard incl. photo) → open the resulting
  `/jobs/posted/:id` → **Cancel job** → **Yes, cancel**.
- **Observed:** status badge correctly flips `open` → `cancelled`, toast "Job cancelled" fires
  (both good). But the Applicants section still shows **"No applicants yet. Verified tradespeople
  in your area are being notified."** — now false, and the "Cancel job" button has simply vanished
  with nothing in its place (no repost / browse-tradespeople / back-to-dashboard action). Confirms
  the reporter's suspicion exactly.
- **Root cause:** `src/views/JobPostDetailView.vue:794` —
  `<p v-if="visibleApplications.length === 0">No applicants yet…</p>` checks only applicant count,
  never `post.status`. Contrast: the `closed` status *is* handled two blocks above (line 777) with
  a dedicated success `<Message>` linking to the converted job — there is simply no equivalent
  branch for `cancelled`.
- **Contrast confirming it's a gap, not by design:** the client dashboard's own "Posted jobs" tab
  (`/dashboard/client`) correctly labels this same post **"Cancelled"** in its list — the
  status-aware pattern exists elsewhere in the app, just missing on this detail page.
- **Fix direction:** add a `v-else-if="post.status === 'cancelled'"` branch (or extend the
  `v-if` above it) with copy like "This post was cancelled — tradespeople have been told it's no
  longer open" plus a "Post a new job" / "Browse tradespeople" CTA, mirroring the `closed` block's
  pattern.

---

## Medium

### MED-1 — Post-sign-in redirect (explicit `?redirect=` and default) lands on Home instead
- **Where:** `/sign-in` and `/sign-in?redirect=<path>`.
- **Repro A (deep-link round trip):** signed out, navigated directly to `/dashboard/client` →
  correctly bounced to `/sign-in?redirect=/dashboard/client` (this half works) → signed in →
  **landed on `/`**, not `/dashboard/client`.
- **Repro B (plain sign-in):** visited `/sign-in` directly (no query param), signed in → also
  **landed on `/`** instead of `safeRedirect`'s own documented fallback of `/dashboard`.
- **Root cause (traced):** `auth.ready` (`src/stores/auth.ts`) is a one-shot latch, set `true`
  after the *first* `applyAuthState` resolves on initial page load (while signed out). The router
  guard (`src/router/index.ts:764`) only does `if (!auth.ready) await auth.init()` — since `ready`
  is already `true` from the initial signed-out load, it does **not** re-wait on a fresh sign-in.
  `SignInView.submit()` calls `router.replace(safeRedirect(...))` immediately after `auth.signIn()`
  resolves — but `auth.signIn()` only awaits `signInWithEmailAndPassword`, not the separate async
  `onAuthStateChanged` → `applyAuthState` callback that actually populates `auth.roles`/
  `activeRole`. The redirect's guard-time role check races that population and loses, sees
  `roles = []`, and bounces to Home (same as an unauthenticated visitor).
- **Impact:** hits **every** sign-in (not an edge case), though recovery is one extra tap
  (Dashboard link in the nav), so it's friction/trust damage rather than data loss or a hard block.
- **Fix direction:** either have `auth.signIn()` await the store's own next `applyAuthState`
  completion before resolving, or have the router guard re-check on a short-lived "roles still
  settling" flag instead of the one-shot `ready` latch.

### MED-2 — Client dashboard tabs don't tear down the previous panel — content stacks
- **Where:** `/dashboard/client`.
- **Repro:** My jobs → Posted jobs → "Show closed (1)" → **Saved trades**.
- **Observed:** after switching to "Saved trades," both the new "No saved trades yet" empty state
  **and** the previous "Posted jobs" panel (its "Hide closed (1)" toggle + the cancelled job card)
  remain visibly rendered, stacked vertically. Confirmed via computed style on both blocks
  (`display:block`, `visibility:visible`, distinct non-zero bounding boxes at different `top`
  offsets) — not an accessibility-tree artifact. Switching to **My jobs** correctly clears
  everything, so the leak is specific to whatever was showing right before landing on "Saved
  trades" (reproduced once via Posted jobs → Saved trades; not yet checked from other tab orders).
- **Fix direction:** audit the tab panel's conditional rendering (`v-show` vs `v-if`, or a missing
  `:key` on a `<component :is>`/panel wrapper) for the Saved Trades panel specifically.

### MED-3 — `/privacy` data-use table overflows the 375px viewport
- **Where:** `/privacy` at 375×667.
- **Observed:** the "Purpose / Information used / Why we need it" table is not wrapped in an
  `overflow-x:auto` container; its cells push `document.documentElement.scrollWidth` to 391px
  against a 360px `clientWidth` (~31px real overflow), causing the whole page to scroll
  horizontally at the primary mobile breakpoint. `main.css`'s own comment notes other tabular
  content (kanban, line-item tables) already has "their own overflow-x:auto" — this table doesn't.
- **Fix direction:** wrap the table in a `overflow-x: auto` container, consistent with the existing
  pattern referenced in `main.css`.

---

## Low

### LOW-1 — Job-post wizard: address autocomplete doesn't populate City, causing a confusing validation dead-end
- **Where:** `/jobs/post`, "Where and when?" step.
- **Repro:** typed a partial address, selected a real Places autocomplete suggestion (e.g.
  "...Mystery Lake, MB, Canada").
- **Observed:** Province (`MB`) and Postal code (`R8N 2A7`) populate correctly from the selection;
  **City is left blank** (verified via direct DOM read, not just the a11y snapshot). Clicking
  Continue correctly **blocks** with "Enter your street address and city so we can map your job."
  — no data-integrity risk — but the user just picked a complete-looking suggestion from a
  dropdown and has no obvious reason to suspect one field silently failed to fill in.
- **Fix direction:** map the autocomplete's `locality`/`postal_town` address component into the
  City field alongside province/postal, the same way the other two already work.

### LOW-2 — Home page has a persistent ~8px horizontal scroll despite an explicit anti-overflow guard
- **Where:** `/` at both 375×667 and 1440×900.
- **Observed:** `body { overflow-x: clip }` (`src/assets/main.css:105`) is explicitly commented as
  a "belt-and-braces guard against a stray over-wide element," but the `.bs-band` full-bleed
  marquee band (`width:100vw`, `main.css:424`) still leaves the page scrollable by exactly ~8px —
  confirmed behaviorally, not just measured: `window.scrollTo(200,0)` settles `window.scrollX` at
  `8` (not `0`). Minor visually, but it defeats a guard the team already invested in and is
  reachable via touch/swipe on mobile.
- **Fix direction:** worth a quick check of whether `html` (not just `body`) needs the same
  `overflow-x` treatment for the propagation rule to fully apply, or constrain `.bs-band` via a
  clipped wrapper one level up.

### LOW-3 — Pricing page `<title>` duplicates the brand name and uses an em dash
- **Where:** `/pricing`.
- **Observed:** rendered `<title>` is `"Pricing — Blue Seal | Blue Seal"`. `PricingView.vue:17`
  passes `useSeo({ title: "Pricing — Blue Seal" })`, and `useSeo` appends its own `" | Blue Seal"`
  suffix, doubling the brand name. Also an em dash in user-facing copy.
- **Fix direction:** change to `useSeo({ title: "Pricing" })`.

---

## Untested / notes (not scored as bugs)

- **`manifest.webmanifest` console error on every route** — `vite-plugin-pwa` has no
  `devOptions.enabled`, so it doesn't serve a manifest under `npm run dev`; the request falls
  through to the SPA `index.html` shell, which the browser can't parse as JSON. This is dev-only
  noise and will not reproduce in the production build — not flagged as a bug, noted so it isn't
  mistaken for one in a future run.
- **Email sends** (verification email, job-post notifications) — Resend key is absent in the
  emulator per the run's expected-limitations note. `sendVerificationEmail` is called
  fire-and-forget (`.catch(() => {})`) in `stores/auth.ts`, so its failure is silently graceful and
  never blocked the UI in this run — not independently verified beyond that.
- **Tradesperson/admin/PM-side flows** (quotes, chat, kanban, invoicing, vetting) — explicitly out
  of scope this run; a separate pass should cover them as their own plain-role accounts per the
  runbook's step-4 guidance.
- **AI-assisted "describe it in your own words" job categorization** on `/jobs/post` step 1 — not
  exercised (used the manual trade-picker path instead, to stay deterministic). Worth a follow-up
  given AI features are Pro-gated and this account isn't Pro — does it paywall gracefully or error?
- **Photo upload** accepted a 36×36 favicon-sized PNG without any dimension/quality warning — not
  investigated further; a real user's job photo would never be this small, so low priority.

---

## Acceptance checklist

- [ ] CRIT-1: `provisionAccount`'s Zod schema accepts `null` for `referralCode`/`referralSignal`/
      `pmCode`; fresh client, tradesperson, and project-manager signups all complete and redirect
      without the "Invalid input" alert; a tradesperson signup actually lands with the
      `tradesperson` role (verify via `/onboarding` no longer bouncing to Home).
- [ ] HIGH-1: cancelling a job post with 0 applicants shows cancellation-aware copy (not "being
      notified") plus a next-step CTA; re-verified by repeating the exact repro above.
- [ ] MED-1: signing in from `/sign-in?redirect=/dashboard/client` actually lands on
      `/dashboard/client`; plain `/sign-in` lands on `/dashboard` (or the app's intended default),
      not `/`.
- [ ] MED-2: My jobs → Posted jobs → Saved trades shows only the Saved Trades panel.
- [ ] MED-3: `/privacy` has no horizontal scroll at 375px (`scrollWidth === clientWidth`).
- [ ] LOW-1/2/3: fixed opportunistically, not blocking.
- [ ] Re-run this file's repros in browser (not just `npm run test:run`) before marking any item
      fixed — none of these are covered by unit/rules tests.
