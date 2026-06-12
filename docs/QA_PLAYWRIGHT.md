# QA runbook — Playwright MCP (Blue Seal)

The playbook Claude follows when asked to QA the app, smoke-test it, find bugs, or walk through pages and report what's broken. **Exploratory** QA driven by a real browser — not the unit/rules/e2e suites.

Blue Seal is an **authenticated** Vue 3 + Vite + Firebase PWA with three roles (`client`, `tradesperson`, `admin`) and a **mobile-first (375px)** design target. That makes its QA materially different from a public site: you must run against emulators, seed roles/data, and sign in before most routes are even reachable.

## When to use this runbook

Trigger phrases: "QA the app / a flow / a route", "smoke test", "find bugs", "click around", "walk through it", "test localhost".

**When NOT to use it:**
- Unit logic → `npm run test:run` (Vitest, colocated `*.test.ts`)
- Firestore rules → `npm run test:rules` (Vitest against the Firestore emulator)
- Prerender/SEO smoke in CI → the real Playwright specs in `e2e/` (`npm run test:e2e`, runs against the built `dist/`)
- A single component's look → just open the dev server in a normal browser

## Prerequisites (verify before starting)

1. **Playwright MCP tools loaded.** Check that `mcp__playwright__browser_navigate`, `_snapshot`, `_console_messages`, `_network_requests`, `_evaluate`, `_click`, `_type`, `_resize` are available.
   - ⚠️ **Blue Seal has no project `.mcp.json`** (unlike some sibling repos). These tools come from a global/user Playwright MCP config. If they're absent, the browser can't be driven — stop and tell the user a Playwright MCP server needs to be configured (project `.mcp.json` or user-level). Don't fake it with the `e2e/` test runner; that's a different tool for a different job.
2. **Run against emulators, not prod.** Blue Seal has no live users and seeding real Firestore is the heavier "verify" path. For exploratory QA use the emulator suite:
   - Set `VITE_USE_EMULATORS=true` in `.env`.
   - Terminal 1: `firebase emulators:start` (Auth 9099, Firestore 8080, Storage 9199, Functions 5001).
   - Terminal 2: `npm run dev` → Vite on **http://localhost:5173**. Wait for the "Local: http://localhost:5173/" line before navigating.
   - The client SDK auto-connects to the emulators (`src/firebase/config.ts`).
3. **Seed roles + data (emulators start empty).** Sign up an account at `/sign-up`, then promote it and seed forms via the existing callables (Functions emulator shell `firebase functions:shell`, or the browser console with the app's `functions` instance):
   - `grantAllRolesForAdminTesting({})` — gives the caller all three roles + an approved `tradespeople/{uid}` profile (so one account can drive client, tradie, and admin flows).
   - `seedIntakeSchemas({})` — populates `intakeFormSchemas/{trade}` so trade-specific intake forms render.
   - `bulkImportProspects(...)` — loads seeded (unverified) prospects for the "request an unverified tradie" + marketplace flows.
4. **Test each role as that role.** `grantAllRolesForAdminTesting` is convenient, but a single all-roles account can **mask role-gating and permission bugs** (an admin sees everything). For anything role-sensitive, also sign in as a *plain* `client` and a *plain* `tradesperson` account and confirm the guard/permission behaves. (Same reason the rules tests always include a non-admin party.)
5. **Mobile-first.** Primary viewport is **375×667**. Check desktop (1440) too, but 375 is the design target — `/jobs/:id` even sets `mobileCompact` to hide shell chrome there.

## Methodology

Spend tokens on **observation**, not narration. Use `TodoWrite` to track the route list.

| What you want | Tool | Why |
|---|---|---|
| Page structure | `browser_snapshot` (depth 3–5) | Accessibility tree — structured, parseable |
| Pixels | `browser_take_screenshot` | Visual regressions only — slow, hard to parse |
| Measure / count / read state | `browser_evaluate` | Run JS: `querySelectorAll`, `getBoundingClientRect`, `localStorage` |
| Errors | `browser_console_messages level="error"` | After every navigation |
| Failed requests | `browser_network_requests static=false` | Filter `api\|callable\|404\|FAILED` — watch callable/Firestore errors |
| Interact | `browser_click` / `_type` / `_press_key` / `_hover` | Real user interaction |
| Resize | `browser_resize` | 375×667 (primary), 768, 1440 |

### Per-route loop
1. `browser_navigate` to the URL.
2. `browser_snapshot` (depth 3–5) for structure.
3. `browser_console_messages level="error"` — new errors?
4. `browser_network_requests static=false filter="api\|callable\|FAILED"` — 4xx/5xx, failed callables, permission-denied?
5. `browser_evaluate` for specifics: `document.title`, `h1`, the role context shown, key counts, viewport overflow.
6. Note findings *immediately* in a running list.

### Auth/route reality (Blue Seal specifics)
- The router guard (`src/router/index.ts` `beforeEach`) waits for `auth.ready`, then **redirects to Home** if a `requiresAuth` route is hit while signed out, or if you lack the route's `role`. So an unexpected bounce to `/` usually means "not authed as the right role," not a broken link.
- A multi-role account **auto-switches `activeRole`** to match the page (Airbnb-style). When QA-ing as a single role, confirm the page renders in that role's context.
- Layout modes: `public` (marketing chrome), `app` (AppShell — side panel + mobile bottom nav), `chromeless` (e.g. `/onboarding`), `hybrid` (app shell when signed in, public chrome when out).

## Route list by role (cover at least these)

**Public / hybrid:** `/`, `/sign-in`, `/sign-up` (+`?as=tradesperson`), `/forgot-password`, `/trades`, `/trades/:trade`, `/search`, `/help`, `/help/:slug`, `/faq`, `/pricing`, `/privacy`, `/terms`, `/jobs/post`, `/tradies/:uid`, `/claim`, `/invite/:token`.

**Client:** `/dashboard/client` (job board), `/request/:uid` (quote request), `/request-prospect/:id`, `/jobs/:id` (kanban + chat), `/invoices/:id/pay`, `/invoices/:id/receipt`, `/account`.

**Tradesperson:** `/dashboard/tradie` (kanban), `/onboarding` (wizard, chromeless), `/jobs/browse` (marketplace), `/jobs/new`, `/my-applications`, `/payouts` (Stripe Connect), `/account/recommendations`, `/jobs/:id`.

**Admin:** `/dashboard/admin`, `/admin/vetting`, `/admin/applications/:uid`, `/admin/users`, `/admin/disputes` (+`/:id`), `/admin/site-content`, `/admin/rebate-programs`, `/admin/support`.

### Key flows to exercise (not just page loads)
- **Signup + trade-specific intake** (`/sign-up?as=tradesperson` → `/onboarding`): does the intake form render trade fields (needs `seedIntakeSchemas`), validate, and submit?
- **Request a quote** (`/request/:uid`) and **job kanban + chat** (`/jobs/:id`): move a job through statuses, send a chat message, check it persists.
- **Invoicing** (`/invoices/:id/pay`, receipt): the pay view does its own `isParty` check — confirm a non-party is blocked.
- **Job board** (`/jobs/browse` → apply with itemized quote → client compares/accepts).
- **Admin vetting** (`/admin/vetting` → `/admin/applications/:uid`): approve/reject path.
- **Mobile 375px:** horizontal overflow, text clipping, bottom-nav reachability, `/jobs/:id` compact chrome.

## Gotchas (real ones for this app)
- **Emulators start empty.** No seed = blank dashboards and "permission denied"/empty states that look like bugs but aren't. Seed first (step 3).
- **Snapshot refs are point-in-time.** Re-snapshot after any navigation before using a ref.
- **Don't QA role-gated flows only as the all-roles admin** — it masks client/tradesperson permission bugs (step 4).
- **Callable errors surface in the network panel,** not always on-screen — watch `browser_network_requests` for failed `callable`/Firestore calls and `permission-denied`.
- **Fixed header / mobile bottom-nav** can intercept clicks near the viewport edges; scroll the target clear before clicking.

## Reporting the findings

Write a tracked doc, not a chat-only summary:
- Path: **`docs/qa-<scope>-audit.md`** (e.g. `docs/qa-client-flows-audit.md`). Don't overwrite the curated root `QA_AUDIT.md` / `UI_UX_AUDIT.md` — those are human-maintained rollups; reference them, append to a scoped file.
- Structure: `Critical / High / Medium / Low / Untested`. Each bug: one-line title + 2–6 lines of evidence (route, what you did, what happened, console/network quote).
- Put the **top 3 to fix first** at the top (user impact × ease).
- End with an acceptance checklist (what "done" looks like for this audit).
- Then return to the main loop a **concise summary only** — counts by severity + must-fix items. Do not paste raw snapshots, console dumps, or the full report back into the conversation; point at the audit file.

## What NOT to do
- Don't paste screenshots/full snapshots into the report — quote the relevant 5–20 lines of the a11y tree.
- Don't claim a bug is fixed unless you re-ran the same browser steps and the new state is clean — `test:run`/`test:rules` don't verify UI behavior.
- Don't run against prod Firestore for exploratory clicking — use emulators. (Real-Firestore verification is a separate, deliberate path with disposable `verify-*` data that gets cleaned up.)
- Don't commit emulator data or MCP session artifacts.
