# QA audit — PM journey + Admin sweep + Sales rep (run D, final)

Exploratory Playwright MCP run against the local emulator suite (Auth 9099, Firestore 8080,
Functions 5001, Storage 9199) + Vite dev server (`http://localhost:5173`,
`VITE_USE_EMULATORS=true`), per `docs/QA_PLAYWRIGHT.md`. Firebase project `blueseal-762af`.

**Scope:** Project manager journey end-to-end (signup → property → project/job creation with
multi-photo → client accept/approve → roster), full admin console sweep (desktop 1280, spot-check
375), sales rep onboarding (agreement + referral code + dashboard), and the `/qa` self-serve
toolkit. This is run D (final) of a multi-run audit — see `docs/qa-client-flows-audit.md`,
`docs/qa-tradesperson-journey-audit.md`, `docs/qa-job-money-path-audit.md` for prior runs; findings
already reported there (signup-null-fields bug, cancelled-post dead end, post-sign-in redirect,
admin-approve-no-confirm, fixed-nav-intercepts-onboarding, invoice $0 tax, receipt-OCR-false-success)
are **not** re-reported here even where the same underlying pattern recurred (noted inline where
relevant).

**Accounts (password `QaPass!2026` for all):** `qa-client@blueseal.test` (existing, plain client,
email verified this run via Auth Emulator UI), `qa-tradie@blueseal.test` (existing, approved
Electrician), `qa-admin@blueseal.test` (existing, all-roles; granted the separate `qa` role this
run), `qa-pm@blueseal.test` (**new this run**, project manager), `qa-rep@blueseal.test` (**new this
run**, sales rep).

**Known bugs, worked around, not re-reported:** every sign-in sometimes lands on Home instead of
role dashboard (intermittent — also observed several successful direct landings this run, so it may
be improving/context-dependent); `manifest.webmanifest` console noise on every route; email sends
fail silently locally (Resend absent) — email-verified qa-client via Auth Emulator UI toggle
(documented in run B), and used the in-UI invite link / the built-in "already signed in" shortcut
(`/claim-project?email=`) instead of the emulator's raw oobCode for the project-invite magic link.

---

## Top 3 to fix first

1. **CRIT-1 — `adminUpsertRegion` 400s on every new-region creation; sales regions cannot be
   created at all.** `functions/src/sales/upsertRegion.ts:19` declares `id: z.string()...optional()`
   without `.nullable()`. The client always sends `id: null` for a new region (confirmed in the
   request body); Zod's `.optional()` rejects literal `null`, only accepts `undefined`. Same
   anti-pattern as the already-fixed `provisionAccount` CRIT-1 (run A) — it has recurred in a new
   file. Blocks a foundational piece of the sales-rep system (regions must exist before a rep can be
   scoped to one) with **zero workaround** and **zero on-screen error** (the form silently fails to
   close, no toast, no message — only visible in the console/network panel). *Fix: `id:
   z.string().trim().min(1).max(128).nullable().optional()`, matching the `photoURL` /
   `provisionAccount` fix pattern. Worth grepping the rest of `functions/src/**/*.ts` for the same
   `.optional()`-without-`.nullable()` shape on any field that can be client-sent as `null`.*
2. **HIGH-1 — PM's own project/job never surfaces in `/manage/jobs` or the dashboard's "Jobs in
   progress" stat once it's filled via the public job board instead of a direct roster match.**
   Confirmed genuine (not a listener-timing false alarm — re-tested with fresh navigation + 3s wait,
   the "Properties"/"Active projects" tiles correctly resolved to 1 on the same load while "Jobs in
   progress" stayed 0). The job **is** visible by drilling PM → Properties → property → project
   (shows "Filled … Quote $96.05" correctly) — so the underlying data is fine; the two rollup
   surfaces (`/manage/jobs`, dashboard stat) are the ones with the gap. Given the onboarding
   checklist's own step 1 is "Add your trusted trades" and a PM can freely create a project before
   populating their roster (nothing blocks it), this is a realistic path for exactly the PMs the
   product is newest to.
3. **HIGH-2 — PM-side copy promises "goes to the public board" but the real behavior needs a
   manual CLIENT step the PM can't see or trigger.** The New Project form warns "No saved trade for
   this — it'll go to the public board" when the trade isn't on the roster. In reality the job is
   created as `invited` with **zero** recipients (the roster was empty) and sits inert — "No
   applicants yet. Verified tradespeople in your area are being notified" is shown to the client,
   which is also inaccurate (nobody is being notified). The client must notice the alert "Your
   project manager sent this to their trusted trades. No quotes yet? Open it to all verified trades
   in your area" and click "Open to all trades nearby" (with its own confirm dialog) to actually
   reach the public board — a step the PM has no visibility into and cannot do on the client's
   behalf. *Fix direction: either auto-open to the public board server-side when the roster has zero
   matches at project-creation time (matching the PM-side copy's promise), or correct the PM-side
   copy to describe the real manual-client-step requirement.*

---

## Critical

### CRIT-1 — `adminUpsertRegion` 400s on every new-region creation
- **Where:** `/admin/regions` → Add region → Save region (as `qa-admin`, desktop 1280).
- **Repro:** Fill Region name "QA Test Region", Province BC, FSA prefix "V1Y", leave rep
  unassigned, Status active, threshold 40 → Save region.
- **Observed:** Console: `Failed to load resource: the server responded with a status of 400 (Bad
  Request) @ .../adminUpsertRegion`. Response body: `{"error":{"message":"Invalid region.","status":
  "INVALID_ARGUMENT"}}`. Request body: `{"data":{"id":null,"name":"QA Test Region","province":"BC",
  "fsaPrefixes":["V1Y"],"repId":null,"status":"active","thresholdActive":40}}`.
- **Root cause (read from source):** `functions/src/sales/upsertRegion.ts` line 19: `id:
  z.string().trim().min(1).max(128).optional()` — no `.nullable()`. The Firebase Callable Functions
  client SDK serializes an unset/`null` field as JSON `null`; Zod's `.optional()` only accepts
  `undefined`, not `null`, so `Input.safeParse` fails for every NEW region (an edit of an existing
  region would send a real string `id` and likely succeed — not verified this run).
- **No on-screen error either:** after the 400, the "Add region" form just sits there — no toast, no
  inline message. An admin has no signal the save failed short of opening devtools.
- **Impact:** Sales regions — the mechanism that scopes a rep's territory, auto-assigns
  tradespeople by address, and drives residual commission — cannot be created through the UI at
  all. Completely blocks that piece of the sales-rep system.
- **Fix:** add `.nullable()` to the `id` field (mirrors the already-shipped fix for
  `provisionAccount`'s `referralCode`/`referralSignal`/`pmCode`). Also add a visible error message on
  failed save.

---

## High

### H1 — PM's own filled job invisible in `/manage/jobs` + dashboard "Jobs in progress" stat
- **Where:** `/manage/jobs`, `/manage` dashboard stat tile, as `qa-pm`.
- **Repro:** Created project "QA Spring Turnover" (1 job, Electrician, no roster match at
  creation time) → client accepted the project → client opened the job to the public board →
  `qa-tradie` applied with a quote ($96.05) → client accepted the quote (job now "Filled",
  confirmed via `/manage/properties/:id` → project detail: "Replace outlet in kitchen … Filled …
  Quote $96.05").
- **Observed:** `/manage/jobs` ("Every trade job across your projects, read-only") shows "No jobs
  yet" — reproduced on repeat navigations with up to 3s wait each time. Dashboard "Jobs in progress"
  stays "0" on the same load where "Properties" and "Active projects" correctly show "1" (so this
  isn't the session's general post-navigation loading race — see L3).
- **Impact:** The one PM surface whose entire job is "every trade job across your projects,
  read-only" fails to show a job that unambiguously belongs to the PM's own project, whenever that
  job was filled via the public board path rather than a direct roster invite.

### H2 — PM copy ("goes to the public board") doesn't match actual dispatch (stays inert, invited, zero recipients)
- **Where:** `/manage/properties` → New project form (job's trade not on roster) vs. the resulting
  job's actual state on `/jobs/posted/:id` (client view) and `/jobs/browse` (tradesperson view).
- **Repro:** Created a job for a trade (Electrician) not yet on the PM's roster.
- **Observed:** Form copy: *"No saved trade for this — it'll go to the public board. Add one to
  your roster to keep it in-house."* Actual state after project acceptance: job badge reads
  `invited`, "Applicants 0", "No applicants yet. Verified tradespeople in your area are being
  notified" (nobody was notified — roster was empty). An alert on the CLIENT's job page reads "Your
  project manager sent this to their trusted trades. No quotes yet? Open it to all verified trades in
  your area" with an "Open to all trades nearby" button (own confirm dialog: "This shares the job
  with all verified trades nearby and can't be undone"). Only after the **client** clicks that does
  the job badge flip to `open` and appear on `/jobs/browse`.
- **Impact:** The PM is told (and would reasonably believe) the job auto-posts to the public board.
  In reality nothing happens until the client separately notices and clicks through an extra
  confirmation the PM has no visibility into. A PM checking their own dashboard has no way to tell
  whether this ever happened.

---

## Medium

### M1 — Fixed bottom mobile nav intercepts multiple fields in the PM "New project" form at 375px
- **Where:** `/manage/properties` → New project (inline form), 375×667.
- **Evidence:** Three separate elements in the same form hit Playwright's 5s auto-retry timeout
  with `<nav class="bottom-nav app-shell__bottom"> subtree intercepts pointer events`: the Property
  dropdown (`getBoundingClientRect` showed `bottom: 651.0` vs the fixed nav's `top: 606.7` —
  complete overlap), the job's Trade dropdown, and the "Add photos" button. All three only became
  clickable after an explicit `scrollIntoView({block:'center'})`.
- **Same root cause already documented** in `docs/qa-tradesperson-journey-audit.md` M1 (onboarding's
  "Mark as no certification" button) — this confirms the pattern recurs in a different, more
  recently-shipped feature (PM project/job creation), not a one-off.
- **Impact:** First-tap failures on a form a new PM is likely to use immediately after signup.
- **Fix suggestion:** as before — bottom padding/scroll-margin on long forms so interactive elements
  never land directly behind the fixed nav; this is now confirmed in two unrelated features, so a
  shared layout-level fix (e.g. `scroll-padding-bottom` on the app-shell content container) would
  likely resolve both at once.

### M2 — Client's project-acceptance address form isn't pre-filled from the PM's property address
- **Where:** `/dashboard/client` → "Projects set up for you" → Accept → address form (Street/City/
  Province/Postal).
- **Observed:** The project was created against a property with a known address ("456 Oak Ave,
  Kelowna, BC") — the PM entered it when adding the property. The client-side accept form's address
  fields are blank, forcing the client to retype an address the PM already has on file.
- **Impact:** Minor duplication/friction, not a blocker (client can type any address here — didn't
  verify whether it's validated against the property). Low-effort win: pre-fill from
  `project.property.address` if present, client can still edit.

### M3 — Consistent ~2-4s blank/wrong-layout flash on fresh navigation to app-shell routes
- **Where:** Observed repeatedly across `/manage`, `/manage/calendar`, `/manage/trades`,
  `/admin/users/:uid`, `/sales/applications`, and others, all session.
- **Observed:** A full-page navigation (not SPA-internal) to almost any authenticated route
  initially renders either a completely empty `<main>` or, in one case (`/sales/applications`), the
  **public/hybrid marketing chrome** (header with "Find a tradesperson"/"Post a job", public footer)
  instead of the app shell — before resolving to the correct layout and content 2-4 seconds later.
  Confirmed NOT a data bug each time (content always arrived correctly given enough wait), but the
  intermediate flash is real and reproducible essentially every time in this session/environment.
- **Impact:** No loading skeleton/spinner covers this gap — a real user refreshing or deep-linking
  into the app sees a jarring flash of the wrong chrome or a blank page for several seconds. Given
  how consistently this reproduced (dozens of times this session, not isolated to one route), it's
  worth a look even though it never produced wrong *data*, only a wrong/blank *frame* while
  auth/role state resolves.

---

## Low

### L1 — Small real horizontal overflow at 375px on `/admin/business-cards`
- **Evidence:** `window.innerWidth: 375` vs `document.documentElement.scrollWidth: 386` (an 11px
  overflow, independent of scrollbar accounting). Traced to the card-preview canvases and their
  containing cards sitting at ~369-370px each inside a `bs-container` with its own padding. Admin
  routes are desktop-first per the runbook (375 is a spot-check here, not a hard requirement), so
  Low rather than Medium.

### L2 — No notification when a PM adds a tradesperson to their roster
- **Where:** `/manage/trades` → search → "Add to roster", then checked `qa-tradie`'s notification
  bell.
- **Observed:** Roster add succeeds (direct Firestore write, "On your roster · 1 person"). Checked
  `qa-tradie`'s notifications immediately after: no new entry related to the roster add — the only
  new item was an unrelated "Your quote was accepted!" from an earlier step in this same run.
- **Impact:** A tradesperson has no way to know a PM has added them to a roster (and that future
  matching projects will route to them for quotes) short of noticing new invited jobs appear.

### L3 — `adminUpsertRegion` failure has no on-screen error (see CRIT-1)
- Folded into CRIT-1 above; noting separately because it's a distinct fix (error surfacing) from the
  root Zod bug, and would still be worth doing even after CRIT-1 is fixed (defense in depth for the
  next schema-validation failure on this form).

---

## PM signup regression — explicit verdict: **PASSED**

Signed up `qa-pm@blueseal.test` via `/sign-up?as=projectManager` at 375×667. The "I'm signing up
as a…" radiogroup correctly pre-selected "A project manager" from the query param. `provisionAccount`
returned **200 OK** (network-confirmed), the app landed directly on `/manage` (not bounced to Home,
not client-only), and the account correctly held `roles: ["projectManager", "client"]` (verified via
`/admin/users/:uid` role editor later). No new console errors beyond the pre-existing manifest
noise. The run-A Zod null-referral-fields fix holds for the PM signup path specifically (run B had
only verified the tradesperson path).

## What worked well (no bugs, noted for completeness)

- **Multi-photo attach on a PM job** (the recent feature this run was asked to exercise): uploaded 3
  photos to a single job in the New Project form; all 3 converted to `.webp` and uploaded to Storage
  (200 OK each), "Add photos" button remained for up to 8 total, "Remove photo" worked per-thumbnail.
  Clean, no issues.
- **Project invite → client claim flow**: the PM-side "Project created" confirmation surfaces the
  shareable invite link directly in the UI (no need to dig through Firestore). The "already signed
  in as the invited email" shortcut in `ProjectClaimView.vue` (`/claim-project?email=`) correctly
  skips the magic-link round-trip when the visitor's current session email matches the invite.
  `claimProjectInvite`'s two-phase preview-then-confirm design (shows "you were invited to X" before
  attaching anything) works cleanly.
- **PM dashboard first-run state**: "Get started 0/3 done" checklist with clear ordered guidance
  (roster → property → project), all stat tiles correctly zero, no horizontal overflow at 375px.
  Good empty states throughout `/manage/jobs`, `/manage/earnings` (correctly gates on the Stripe
  payout agreement), `/manage/clients` and `/manage/calendar` (correctly Pro-gated, matches the
  documented Clients-tab Pro pattern).
- **Sales rep onboarding**: agreement signature (canvas + `signature_pad`) and referral-code claim
  both completed cleanly (`signSalesAgreement` and `claimReferralCode` both 200 OK); `/sales/
  applications` empty state explains both region- and referral-code-scoping; `/sales/payouts` clearly
  gates on Stripe Connect; `/sales/resources` accordion (program rules, signing up, vetting, getting
  paid, pitching, FAQ) all present.
- **Admin role editor**: confirm-before-apply dialog on every role change ("This will add sales for
  QA Rep") — good contrast with the no-confirmation issue already flagged for tradesperson approval
  in run B.
- **Admin queues**: `/admin/disputes`, `/admin/support`, `/admin/onboarding`, `/admin/bug-reports`
  (kanban board + list view), `/admin/errors` all have clear, correctly-scoped empty states and
  filter controls; `/admin/jobs` search/filter by province/status worked and correctly showed both
  jobs created across this run and run C.
- **Site content (testimonials) editor**: added a testimonial, confirmed it rendered live on the
  public homepage, removed it again — round-trip works cleanly, no errors.
- **`/qa` toolkit**: once the separate `qa` role was granted (see Untested note below), the page
  rendered the full checklist (0% progress, sections for Setup/Roster/Properties→Projects→Jobs/
  Dispatch/Money/Public profile/PM tools/Mobile), provisioning shortcuts (tradesperson, PM, sales
  rep, Pro toggle, reset data), Stripe sandbox card reference, error log, and bug reports. Manually
  toggled one checklist item pass → fail-state UI and shared-progress attribution ("QA Admin · just
  now") both worked correctly; reset it back to unmarked afterward (see State left behind).

## Untested / not reached

- **`/qa` route requires a separate `qa` role, distinct from `admin`.** `qa-admin@blueseal.test`
  (seeded as "all roles") did not have this flag set — navigating to `/qa` silently redirected to
  Home (the standard role-gate behavior, not a bug: `src/router/index.ts:723` requires `role: "qa"`
  specifically). Granted it via `/admin/users` to complete this task's checklist item; worth a note
  in the seed docs that "all roles" for QA testing purposes should include the `qa` flag too, since
  it's needed to reach the QA toolkit itself.
- Region **editing** (vs. creation) was not tested — `id` would be a real string there, so CRIT-1
  might not reproduce on the edit path. Worth a quick follow-up once CRIT-1 is fixed.
- Rebate programs "Import starter set" was not exercised (starter-set preview looked correct,
  no import performed to avoid a real content mutation with no test benefit).
- Business card actual PDF/PNG generation/download was not exercised (preview + QR caption looked
  correct).
- Sales rep Stripe Connect payout onboarding was not clicked through (out of scope for this pass;
  `/sales/payouts` empty state itself looked correct).
- Prospect outreach: view-only as instructed — no import, no send attempted.
- `/admin/vetting` was not in this run's explicit scope (covered by run B).

---

## State left behind (emulator only, not production)

- `qa-pm@blueseal.test` — new PM account. Has 1 property ("QA Test Rental - 456 Oak Ave"), 1
  accepted project ("QA Spring Turnover", 1 job, status Filled), 1 roster entry (`qa-tradie`,
  Electrician).
- `qa-rep@blueseal.test` — new client-turned-sales-rep account. `sales` role granted, agreement
  signed, referral code `QAREP` claimed.
- `qa-admin@blueseal.test` — gained the separate `qa` role (needed for `/qa` toolkit access; was
  previously client/tradesperson/admin only).
- `qa-client@blueseal.test` — email now verified (toggled via Auth Emulator UI to unblock
  `claimProjectInvite`'s `email_verified` requirement); claimed + accepted the new PM project;
  applied-to/accepted a quote from `qa-tradie` on the resulting job (now Filled).
- `qa-tradie@blueseal.test` — submitted one additional application/quote (Q-2026-0002, $96.05,
  accepted), now on `qa-pm`'s roster.
- New job `jobs/TT4W5uui0F61K7QgvGqj` ("Replace outlet in kitchen") — terminal-ish state: Filled,
  quote accepted, not yet invoiced/paid (money-path steps not exercised this run — that was run C's
  scope on a different job).
- Sales region "QA Test Region" was **not** created (the save failed with 400 — see CRIT-1), so no
  region cleanup is needed.
- Site content: a test testimonial was added and removed in the same session — net no change.
- Session ended **signed out**.

---

## Acceptance checklist (what "done" looks like for this audit)

- [ ] CRIT-1 fixed: `adminUpsertRegion`'s `id` field takes `.nullable()`; a new region can be
      created end-to-end through `/admin/regions`, and a failed save shows a visible on-screen error.
- [ ] H1 investigated: confirm whether `/manage/jobs` and the dashboard "Jobs in progress"/"Unpaid
      earnings" tiles query by a roster/dispatch-type filter that excludes board-filled jobs, and
      either broaden the query or document the scoping intentionally in the empty-state copy.
- [ ] H2 resolved: PM-side "will go to the public board" copy either becomes true (auto-open when
      roster has zero matches) or is corrected to describe the actual client-side manual step.
- [ ] M1 addressed for the New Project form specifically (in addition to the existing onboarding
      instance) — ideally via a shared layout fix given it's now confirmed in two features.
- [ ] Re-run the PM journey happy path end-to-end once H1/H2 are fixed to confirm `/manage/jobs`
      shows the job and the dashboard stat updates.
