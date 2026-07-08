# Blue Seal: Full-platform QA pass and gap assessment (2026-07-07)

One-day, whole-platform audit: every role surface, code-level gap scans, and live browser QA
against the emulator suite. This document is the **fix plan**. Work it phase by phase; each item
has a stable ID, evidence, a fix direction, and an effort size. Do not renumber shipped IDs.

**How to use this doc**

- Phases are ordered by user impact. Finish (or consciously defer) a phase before starting the next.
- Each item: `[ ]` checkbox, ID, severity, effort (S = under an hour, M = half day, L = day plus).
- Deep repro steps live in the per-run audit files, referenced as (run A/B/C/D):
  - Run A: `docs/qa-client-flows-audit.md` (public + auth + client journey)
  - Run B: `docs/qa-tradesperson-journey-audit.md` (signup → onboarding → vetting → apply)
  - Run C: `docs/qa-job-money-path-audit.md` (accept → work order → extras → invoice → pay → reviews)
  - Run D: `docs/qa-pm-sales-admin-audit.md` (PM, sales rep, admin surfaces)
- When you fix an item, re-run the referenced repro in the browser (unit tests alone do not close
  these), tick the box, and note the commit hash beside it.

**Method and coverage**

- Six parallel code-level scans: spec completeness, client UX, tradesperson UX, PM/sales/admin UX,
  cross-cutting consistency (notifications, help, PWA, a11y), money paths + security.
- Four sequential live Playwright runs against the emulator suite at 375x667 (desktop spot-checks),
  as plain single-role accounts per the runbook (not the all-roles admin).
- Baseline gates at audit start: lint clean, typecheck clean, 465/465 unit tests green. Everything
  below is a gap, edge case, or missing state, not a broken build.

**Overall read:** the codebase is in genuinely good shape. Double-submit guards, humanized errors,
save-and-resume onboarding, server-computed money, parent-lookup list rules, and a 43-type
notification system are all consistently applied. The single biggest find was a systemic bug CLASS
(not a one-off): a Zod `.optional()`-without-`.nullable()` pattern that made the callable SDK's
`null` serialization 400 the DEFAULT path of 10 callables, including the passwordless login for
invited tradespeople and sales-region creation. All 10 were fixed, deployed, and verified during
the audit (Phase 0). Beyond that: a handful of High correctness/trust items and a long tail of
polish. Nothing found contradicts the architecture; nearly everything is additive.

---

## Scorecard by area

| Area | State | Headline gaps |
| --- | --- | --- |
| Signup + auth | 2 Criticals found + fixed + deployed (signup, passwordless login) | Sign-in redirect race remains (P1-03) |
| Client journey | Strong | Cancelled-post dead end (P1-04), dashboard tab stacking (P2-01) |
| Tradesperson journey | Strong | 375px tap interception (P1-07), email-verify signposting (P1-08) |
| Job lifecycle + money UI | Strong: full accept→work→invoice→pay→review loop verified live, line-item math exact | Invoice tax defaults to 0% (P1-11), no dispute entry point (P2-15) |
| Money backend | Strong core, weak edges | Webhook retry drop (P1-01), commission edge cases (P3) |
| PM / sales / admin | Functional, thin edges | 2nd null-schema bug blocks region creation (P0-02), PM job-rollup gap (P1-00), one-click approvals (P1-06) |
| Notifications | Very broad, copy verified correct live | Internal type overloading (P2-08), no job-alert opt-out UI (P2-09), stale withdrawn-CO alert (P2-18) |
| Security | Solid rules, two real gaps | Assistant XSS (P1-02), App Check off pre-launch (P1-09) |
| PWA / offline | Installable, not offline-graceful | iOS meta, maskable icon, offline fallback (P4) |
| Docs / spec | Drifted from the shipped product | design.md fee model + missing systems (P5) |

---

## Phase 0: Fixed during this audit (verify in prod, then close)

### [x] P0-01 · Critical · provisionAccount rejected every signup; tradesperson/PM signups silently downgraded to client
- **What:** the Zod schema declared `referralCode` / `referralSignal` / `pmCode` as `.optional()`
  without `.nullable()`; the client always sends these keys and they arrive as `null`, so
  `Input.safeParse` failed on 100% of signups (email/password and Google, all three roles). The
  orphan self-heal then re-provisioned with a hardcoded `role: "client"`, so a tradesperson or PM
  signup silently became a plain client with no visible error. Full trace: run A, CRIT-1.
- **Why prod almost certainly never saw it:** the schema shipped in the June 25 PM-recruiting
  commits, and prod tradesperson signups demonstrably worked during the July 5 cert-upload bug
  session. The deployed function predates the schema (older deploys ignore unknown keys). This was
  an armed landmine set to detonate on the next `functions` deploy that included provisionAccount.
- **Fix applied:** `.nullable().optional()` on all three fields (the sibling `photoURL` already
  used this exact pattern), `functions/src/auth/provisionAccount.ts:21-25`. Verified three ways:
  direct callable invocation with explicit nulls, then a full fresh tradesperson signup in run B
  (correct roles, lands on /onboarding), plus the client-role path in run A's account.
- **Deployed:** `firebase deploy --only functions:provisionAccount`, see commit for status.
- **Follow-up (S):** after the next prod deploy, run one throwaway prod signup to confirm, per the
  acceptance list in run A. Consider the two defense-in-depth items: make the orphan self-heal
  role-aware instead of hardcoding `client`, and surface a visible error when provisioning fails.
- **Prod-verified:** disposable tradesperson signup on blueseal.app returned provisionAccount 200,
  token carried `role: "tradesperson"` + `roles: ["tradesperson","client"]`, landed on /onboarding;
  the disposable account was then deleted. This item is fully closed.

### [x] P0-02 · Critical · A whole CLASS of null-schema bugs 400'd 10 callables (login, legal, admin)
- **The pattern (this is the single biggest finding of the audit):** the Firebase callable JS SDK
  serializes any object key whose value is `undefined` to explicit `null` on the wire. The web
  client includes optional fields in its call payloads unconditionally, so they arrive as `null`.
  A Cloud Function Zod input declared `.optional()` WITHOUT `.nullable()` rejects `null`, so the
  callable 400s "Invalid input" on the DEFAULT path (whenever the user leaves the optional thing
  blank). P0-01 (provisionAccount) was the first symptom; run D surfaced a second (adminUpsertRegion);
  a full sweep of `functions/src/**` against every client call site then found the rest.
- **Fixed today (all `.nullable().optional()`, every field already consumed null-safely, so pure
  validation-widening), deployed targeted, committed, and verified:**
  1. `requestSignInLink.redirect`, the passwordless "email me a sign-in link" path 400'd on every
     normal (no `?redirect=`) visit. This is the PRIMARY login for invited tradespeople who never
     set a password. Emulator- AND prod-verified (`{redirect:null}` now returns ok).
  2. `adminUpsertRegion.id`, new sales regions could not be created at all (run D, CRIT-1), with
     no on-screen error. Emulator-verified (`{id:null}` now creates the region).
  3. `requestAccountDeletion.reason`, PIPEDA self-serve account deletion 400'd when no reason typed.
  4. `selfServeRemoveProspect.reason`, non-consenting listing takedown 400'd when no reason typed.
  5. `sendVouchRequest.message`, recommendation request 400'd when sent without a note.
  6. `sendJobReferral.message`, refer-a-job 400'd when sent without a note.
  7. `resendJobInvite.newEmail` + `.newClientName`, fix-and-resend invite 400'd.
  8. `adminSetUserDisabled.reason` + `adminSoftDeleteUser.reason`, admin suspend/soft-delete 400'd
     when no reason typed.
  9. `reportClientError.{stack,context,route,userAgent,appVersion}`, NOT a user 400 (safeParse →
     `{ok:false}`, fire-and-forget) but SILENTLY DROPPED all client error telemetry whenever a field
     was unset, so the admin error queue was blind. Restored.
- **Why prod mostly survived until now:** the deployed functions predated these schema fields (older
  deploys ignore unknown keys), so this was largely an armed landmine for the next deploy rather than
  a live outage, but the login and region paths were the exceptions most likely to already bite.
- **Regression coverage:** provisionAccount + adminSetUserDisabled + adminSoftDeleteUser now assert
  the explicit-null payload is accepted; functions suite 213/213 green. Commits: `52a6702` (P0-01)
  and `f07dcb2` (this batch).
- **Systemic guard (do this so a third instance can't ship):** P5-09, a lint rule or shared
  `optionalNullable()` helper for all callable input schemas.
- **Follow-up (S):** surface a visible error toast on a failed region save (run D, L3), the form
  currently fails silently regardless of cause; the same "no visible error on callable failure"
  gap likely exists on the other forms above and is worth a shared treatment.

---

## Phase 1: Correctness and trust (do these before real users)

> **Status (2026-07-07): all Phase 1 items shipped to `main`, functions/rules
> deployed.** Commits: P1-01 `1cd0358`, P1-02 `397dbea`, P1-04 `e87092a`,
> P1-05 `ac7a32c`, P1-07 `3f287c1`, P1-08 `bd4ace4`, P1-06 `74bec5d`,
> P1-11 `dd5ec25`, P1-10 `66db5b2`, P1-09 `ffd181e`, P1-00/P1-0A `8367310`,
> P1-03 `b30f3de`.
>
> **Verified by gates + deploy:** P1-01 (unit test + deploy), P1-02 (jsdom
> sanitization test), P1-10 (643 rules tests), P1-11 (8 unit tests + deploy),
> P1-00 (rules tests + deploy), P1-09 (docs).
> **Code-complete, browser re-verify still pending** (needs seeded roles per the
> runbook): P1-03 (sign-in redirect acceptance list), P1-04/P1-05/P1-06/P1-07/
> P1-08 (UX screens at 375px), P1-0A (copy). P1-07's shared scroll-padding fix
> and its two flagged screens especially want an eyeball at 375px.
>
> **Decision surfaced (P1-0A):** auto-opening an unmatched PM job to the public
> board (the better UX) needs geocoding at dispatch AND removes the client's
> confirmation gate, so the copy was made honest instead — confirm whether to
> build the auto-open.

### [x] P1-00 · High · UX · PM's own filled job vanishes from /manage/jobs and the dashboard stat
- Once a PM project's job is filled via the public job board (rather than a direct roster match),
  it stops appearing in `/manage/jobs` ("every trade job across your projects, read-only") and the
  dashboard "Jobs in progress" tile stays 0, while the same job shows correctly under Properties →
  project detail ("Filled, Quote $96.05"). Confirmed genuine, not a load race (Properties/Active
  projects tiles resolved to 1 on the same load). The two rollup surfaces query by a
  roster/dispatch filter that excludes board-filled jobs. Evidence: run D, H1.
- Fix: broaden the `/manage/jobs` + dashboard-stat query to include board-filled jobs belonging to
  the PM's projects (or document the scoping in the empty-state copy if intentional). Effort: M.

### [x] P1-0A · High · Trust · PM "goes to the public board" copy doesn't match actual dispatch
- The New Project form promises an off-roster job "will go to the public board", but the job is
  created `invited` with zero recipients and sits inert (client sees the false "tradespeople are
  being notified" line) until the CLIENT separately notices a prompt and clicks "Open to all trades
  nearby", a step the PM can't see or trigger. Evidence: run D, H2.
- Fix: either auto-open to the public board server-side when the roster has zero matches at
  creation (making the copy true), or rewrite the PM copy to describe the real client step. Decide
  which; the auto-open is the better UX. Effort: M. (Related to P1-04's false "being notified"
  copy, same line, different trigger.)

### [x] P1-01 · High · Money · Stripe webhook: a transient failure permanently drops the event
- A failed dispatch marks the sentinel `failed` and returns 500, but Stripe's retry then hits the
  `ALREADY_EXISTS` sentinel and gets a 200 "duplicate", so it stops retrying. The payment
  succeeded in Stripe but the invoice never marks paid, the job sticks at awaiting_payment, and
  rep/PM commission never accrues. No self-recovery.
- Evidence: `functions/src/payments/stripeWebhook.ts:102-123` (duplicate short-circuit) +
  `:241-268` (failure path). Verified by direct read.
- Fix: on `ALREADY_EXISTS`, read the sentinel and only short-circuit when `status === "processed"`;
  reprocess `failed`/stale-`processing` events (handlers are already individually idempotent, so
  reprocessing is safe). Effort: S-M. Add a unit test for the retry-after-failure path.

### [x] P1-02 · High · Security · AI assistant renders model output through a regex blocklist, not a sanitizer
- `renderMarkdown` = `marked.parse` + strip `<script|style|iframe|object|embed>`. Misses event
  handlers (`<img onerror>`), `<svg onload>`, and `javascript:` hrefs. Reachable via prompt
  injection (e.g. OCR'd receipt text or another party's job description flowing through the
  assistant), then rendered via `v-html` in an authenticated session.
- Evidence: `src/components/assistant/AssistantThread.vue:18-22,189`. Verified by direct read.
- Fix: add DOMPurify (not currently in the bundle) over the rendered HTML; keep the blocklist as
  belt-and-braces if you like. Audit the two sibling `v-html` users (`MarkdownProse.vue`,
  `LegalDocument.vue`), trusted content today, same helper recommended. Effort: S-M.

### [x] P1-03 · High (hits every sign-in) · UX · Post-sign-in redirect always lands on the marketing homepage
- Both `/sign-in?redirect=...` and plain sign-in drop the user on `/` instead of the dashboard or
  deep link. Root cause traced: `auth.ready` is a one-shot latch set during the signed-out initial
  load; `SignInView` redirects immediately after `signInWithEmailAndPassword` resolves, racing the
  async `applyAuthState` that populates roles, so the guard sees `roles: []` and bounces Home.
- Evidence: run A, MED-1 (reproduced on every sign-in, both variants); also resurfaced in run B
  (L5). `src/router/index.ts:764` + `src/stores/auth.ts`.
- Fix: have `auth.signIn()` (and the Google path) await the store's own next `applyAuthState`
  completion before resolving, or add a "roles settling" await in the guard. Acceptance: run A's
  checklist (deep-link round trip lands on the deep link; plain sign-in lands on /dashboard).
  Effort: M, touch carefully, this guard also handles role auto-switching.

### [x] P1-04 · High · UX · Cancelled/expired job post is a dead end with actively false copy
- After Cancel, the post page still says "No applicants yet. Verified tradespeople in your area
  are being notified." with no next-step CTA. The `closed` status two blocks above has a proper
  terminal treatment; `cancelled`/`expired` have none.
- Evidence: run A, HIGH-1 (live repro) + `src/views/JobPostDetailView.vue:742-796`.
- Fix: add the `cancelled`/`expired` terminal banner ("This post is no longer open") + "Post a new
  job" / "Browse tradespeople" CTAs, and gate the "being notified" line on the post being open.
  Also fix the dangling sentence in the `closed` branch when `convertedJobId` is missing
  (`:777-788`). Effort: S.

### [x] P1-05 · High · UX · Approved tradesperson bounced into onboarding on a transient fetch error
- `TradieDashboard.onMounted` awaits `getTradesperson` with no try/catch; a null result redirects
  to onboarding, and a thrown fetch strands the view with no retry. An approved pro on flaky
  mobile data gets told to redo onboarding.
- Evidence: `src/views/dashboards/TradieDashboard.vue:204-214`. Verified by direct read. Same
  pattern (no error/retry branch) in `BrowseJobsView.vue:104-105` (infinite spinner, feed errors
  indistinguishable from empty feed at `:313-320`).
- Fix: try/catch + retryable error state; never redirect on a failed fetch (only on a confirmed
  `draft` status). Effort: S-M for both views.

### [x] P1-06 · High · Trust · One-click "Approve everything" with zero confirmation (admin AND rep)
- Admin: `/admin/applications/:uid`, one click approves every pending cert + ID and sets the
  profile publicly live, confirmed live in run B even for a self-declared no-certification
  application (run B, H1). Rep: same gap on `/sales/applications/:uid`
  (`SalesApplicationReviewView.vue:173`); reject/request-info get dialogs, approve does not.
- Manual vetting is the product's entire trust proposition; the one irreversible-feeling action
  should not be a misclick. Fix: confirm dialog on both approve paths, with an extra-explicit
  variant when any credential is self-declared/no-file. Effort: S.
- Related copy fix while in there: the approval notification says "Your electrician certification
  was verified" even when the tradesperson declared no certification (run B, L3).

### [x] P1-07 · High at 375px · UX · Fixed bottom nav intercepts taps (confirmed in TWO features)
- The fixed bottom bar sits over interactive elements at 375x667 and eats the first tap. Confirmed
  in two unrelated, separately-shipped features: the onboarding wizard's "Mark as no certification"
  button (run B, M1, with getBoundingClientRect proof) AND the PM New Project form's Property
  dropdown, Trade dropdown, and Add-photos button (run D, M1). Both are flows a brand-new user hits
  immediately. Two instances means this is a layout-level bug, not a per-screen one.
- Fix: a shared fix at the app-shell content container (e.g. `scroll-padding-bottom` / bottom
  padding equal to the fixed nav height) should resolve both at once; then sweep other long forms.
  Effort: S-M (one shared fix + verification across both screens).

### [x] P1-08 · Medium (blocks every first submit) · UX · Email-verify requirement unsignposted until the final Submit fails
- All 7 wizard steps complete, then `submitForVetting` 400s with "Verify your email before
  submitting." The banner exists at the top of the page but nothing ties the requirement to the
  Submit action until after the failure.
- Evidence: run B, M2/Top-3. Fix: on the review/submit step, show the requirement inline (disabled
  submit + "verify your email first" helper, with the resend button right there). Effort: S.

### [x] P1-09 · Launch gate · Security · App Check is off for every callable (deliberate, but must flip before launch)
- `CALLABLE_OPTS.enforceAppCheck` is env-driven and defaults off; the code comment documents the
  coordination plan (provision reCAPTCHA Enterprise key, ship client App Check init, then set
  `ENFORCE_APP_CHECK=true`). Not a bug, an unticked launch-gate item that CLAUDE.md's "always
  enforceAppCheck" rule makes easy to misread as done.
- Evidence: `functions/src/lib/callable.ts:17-21`. Also flip `QA_TOOLKIT_ENABLED` off at launch
  (`functions/src/qa/guard.ts:20-28`, currently defaults on, and the self-provisioning callables
  ride behind it).
- Action: add both to HUMANTASKS.md as launch blockers with their coordination steps. Effort: S to
  track, M to execute (key provisioning + client init + staged rollout).

### [x] P1-10 · Medium · Security hygiene · Rules tests missing for the vetting-PII collections
- `idVerifications` (ID documents, the most sensitive data in the product) has no allow+deny rules
  test pair; same for `certifications`, `insuranceVerifications`, `wsibVerifications`, `bookings`,
  `aiUsage`, `assistantConversations`, `auditLog`.
- Evidence: tests/rules glob + grep (money/security scan). The rules themselves look correct; this
  is regression protection so they stay correct.
- Fix: add allow+deny pairs starting with the PII collections. Effort: M (test-writer agent work).

### [x] P1-11 · High · Money · Invoice defaults every job-accrued line to 0% tax
- Time entries, expenses, and approved change orders all land on the invoice at 0.0% tax, so the
  sent invoice shows Tax $0.00 against the accepted quote's 13% ($41.60 on the run C job). None of
  the entry dialogs (clock-out, add-expense, propose-extra) offers a tax field, and the invoice
  builder doesn't inherit the quote's rate. A GST/HST-registered tradesperson silently
  under-collects on every job-billables invoice. Line-item math itself verified exact
  ($85 time + $46 marked-up expense + $80 extra = $211.00).
- Evidence: run C, H1 (live end-to-end; invoice INV-2026-0001).
- Fix direction: inherit the accepted quote's tax rate as the default for job-accrued invoice
  lines (with per-line override in the builder), or a job-level tax-rate setting applied at
  pull-billables time. Add an invoice-math unit test covering quote-rate inheritance. Effort: M.

---

## Phase 2: High-value UX friction (the journeys people feel)

> **Status (2026-07-08): 20 of 22 shipped to `main`, functions/rules deployed.**
> Commits: client/tradie UX batch `a7f5b3c` (P2-01,02,04,05,11,12,13,14);
> `aca1e69` (P2-16,17); `343eba5` (P2-18); `1424ee9` (P2-09,10); `5c62df7`
> (P2-22); `8e6a4f6` (P2-21); `2860098` (P2-19); `fc6f655` (P2-07); `cadffb8`
> (P2-06); `4654982` (P2-15); `16fdc84` (P2-08).
>
> **Deferred (2):** P2-03 (service-area radius cap — a concurrent session owns
> LocationPicker/profile pickers; hand off to that session). P2-20 (auth chrome
> flash — fixing the app-root layout gate blind risks an SSG/hydration
> regression on public pages; needs a 375px browser-verified pass, and it pairs
> with P1-03's acceptance run).
>
> **Browser re-verify still pending** for the UX items (per this doc's rule);
> gates (lint/build/tests/rules) + targeted deploys are green for all 20.

### [x] P2-01 · Medium · Client dashboard tabs stack instead of switching
- Posted Jobs → Saved Trades leaves both panels rendered and visible (verified via computed style,
  run A MED-2). Fix: audit the tab panels' `v-if`/`v-show`/`:key` wiring. Effort: S.

### [x] P2-02 · Medium · Pending-vetting dashboard List tab is blank white space
- The status banner is good, but below it the List tab renders nothing at all while pending;
  /jobs/browse and /account handle the same state well (run B, M3). Fix: pending-state placeholder
  ("You'll see jobs here once you're approved") consistent with the browse view. Effort: S.

### [ ] P2-03 · Medium · Profile service-area radius caps at 200 km while the feed filter allows 500 km
- `LocationPicker.vue:40` (`maxRadius: 200` default) vs `BrowseJobsView.vue:61` (500). The known
  pending TODO, confirmed live in run B (slider aria-valuemax=200). Fix: pass the larger max into
  onboarding/profile pickers; decide the real product cap once. Effort: S.

### [x] P2-04 · Medium · Rejected application state sends mixed messages
- Banner says "reply to the email for next steps" (and no email may exist, Resend is a launch
  dependency) while the form stays editable with a live "Submit for review" button
  (`OnboardingWizard.vue:167,958-962,1601-1607`). Decide: lock on rejected, or make self-service
  resubmit explicit. Effort: S once decided.

### [x] P2-05 · Medium · Wrong-role deep link silently bounces to Home
- Signed-in user hitting a route their role lacks lands on `/` with zero explanation
  (`src/router/index.ts:780`); signed-out users correctly get `/sign-in?redirect=`. Fix: route to
  their dashboard with a "that page isn't available on this account" toast, or offer the role
  switch when they hold the role. Effort: S. (Verify alongside P1-03, same guard.)

### [x] P2-06 · Medium · PM realtime views spin forever on a failed subscription
- `PmJobsView.vue:29`, `PmCalendarView.vue:35`, `ProjectDetailView.vue:93`, `PmClientsView.vue:34`
  clear loading only in the success callback; no onError → infinite "Loading...". Fix: error
  callback + retry state on the four subscribe* call sites (and add onError plumbing to the
  services if absent). Effort: M.

### [x] P2-07 · Medium · PM earnings hides refund reversals entirely
- `PmEarningsPanel.vue:93-106` shows Unpaid/Paid only; a client refund silently shrinks the
  balance with no explanation (the rep view at least carries a netting note,
  `SalesRepPayoutsView.vue:96`). Fix: add the netting note + show reversal line items. Effort: S-M.

### [x] P2-08 · Low-Medium · Notification types overloaded internally (visible copy is fine)
- The code scan flagged `invoice_sent` reused for 8 non-invoice events and payout events reusing
  `invoice_paid`/`invoice_payment_failed`. Run C then verified live that user-visible copy is
  CORRECT: every call site passes an event-specific title/body and a ctaLabel override ("QA Tradie
  sent you a quote", "Change order approved", etc.), so this did not reproduce as user-facing
  mislabeling. What remains is internal: type-keyed icons, analytics, and any future type-based
  filtering or preference all see the wrong event, and the workaround comment in `submitQuote.ts:282`
  acknowledges the missing types.
- Evidence: `functions/src/jobs/submitQuote.ts:282-293`, `payments/handlers/payout.ts:150,169`,
  `lib/notify.ts:138-140` (ctaLabel seam); run C notification notes (live verification).
- Fix: add dedicated `quote_received` / `quote_declined` / `work_finished` / `payout_paid` /
  `payout_failed` types when convenient; delete or wire the dead `review_received` type. Effort: M,
  low urgency.

### [x] P2-09 · Medium · Job-alert broadcasts have no opt-out UI
- Server honors `newJobPostingEnabled` but Account view exposes no toggle for it, tradespeople
  get every area-match email with no way off except all-email-off. Evidence: `lib/notify.ts:337`
  vs `AccountView.vue:1680-1719`. Fix: "Job alerts" toggle in notification prefs. Effort: S.

### [x] P2-10 · Medium · No in-app path for an existing user to become a project manager
- `/welcome` offers PM only to brand-new accounts; AccountView offers "Become a tradesperson" and
  "Add client view" but not PM, though `addRoleToSelf` fully supports it
  (`AccountView.vue:1503,1526`, `functions/src/auth/addRoleToSelf.ts:111`). Fix: add the
  Become-a-PM card. Effort: S.

### [x] P2-11 · Low-Medium · Search error shows raw technical text
- `SearchView.vue:233` assigns `(e as Error).message` straight into the banner, the only view
  skipping `humanizeError` (already imported). Fix: one line. Effort: S.

### [x] P2-12 · Medium · /privacy table busts the 375px viewport
- ~31px of real horizontal scroll at the primary breakpoint (run A, MED-3). Fix: overflow-x
  wrapper per the existing main.css pattern. Effort: S. Sweep /terms for the same shape.

### [x] P2-13 · Low-Medium · Tradesperson profile shows no CTA to signed-in non-clients
- `primaryCta` returns null for e.g. a tradesperson viewing a peer (`TradieProfileView.vue:464-475`)
 , silent dead end where "Switch to hiring" belongs. Effort: S.

### [x] P2-14 · Low · Job-post wizard: address autocomplete fills province+postal but not City
- Confusing validation stop after picking a complete-looking suggestion (run A, LOW-1). Fix: map
  `locality` into City. Effort: S.

### [x] P2-15 · Medium-High · No client-side entry point to open a dispute
- A full disputes system exists (admin queue, detail view, notification type), but a client on a
  paid job has no "report a problem / dispute" affordance anywhere, only the generic Help link.
  The trust promise implied by "disputes" is unreachable by the people it protects.
- Evidence: run C finding #4 (searched the terminal paid job's UI exhaustively).
- Fix: a "Report a problem with this job" action on the job detail (post-completion states at
  minimum) that opens a dispute or a support ticket routed to the disputes queue. Decide the
  intake shape first (dispute doc vs support ticket with jobId). Effort: M.

### [x] P2-16 · Medium · Receipt OCR fakes success when it extracts nothing
- `parseReceipt` returns 200 with every field null and the UI toasts "Receipt read. Give the
  fields a once-over and save.", pre-filling a $0.00 "Unknown vendor" expense. This is the free
  flagship AI feature; on a real blurry photo it will quietly do nothing and claim it worked.
- Evidence: run C finding #2 (live, no AI key: the null-result path is exactly what a failed
  extraction produces).
- Fix: when all extracted fields are null/empty, say so ("Couldn't read this receipt, fill in the
  details manually") and skip the success toast; server-side, distinguish "no key/model error"
  from "model returned nothing". Effort: S-M.

### [x] P2-17 · Medium · Client's live "Charges so far" omits expense lines
- Mid-job, the client's running total showed $165 while the tradesperson's showed $211; the $46
  marked-up materials expense was invisible client-side until the invoice arrived (where it bills
  correctly). Surprise line items at invoice time is exactly the trust moment to avoid.
- Evidence: run C finding #3 (simultaneous two-account comparison).
- Fix: include billable expenses in the client's charges-so-far rollup (marked-up price), or label
  the rollup "Labour so far" if the omission is intentional. Effort: S-M.

### [x] P2-18 · Low-Medium · Withdrawn change order leaves a live "approve or decline" notification
- Tradesperson withdrew an $808 change order; the client's bell still offered it as actionable.
  Evidence: run C finding #5. Fix: on withdraw/cancel, mark the related notification resolved (a
  `relatedId` cleanup on the notify doc), or have the job view reconcile stale CO notifications on
  open. Effort: S-M.

### [ ] P2-20 · Medium · Blank/wrong-chrome flash for 2-4s on fresh navigation to app routes
- Deep-linking or hard-refreshing almost any authenticated route renders an empty `<main>` or, in
  one case, the public marketing chrome, for 2-4 seconds before the app shell resolves; reproduced
  dozens of times in run D (M3). No skeleton covers the gap. Likely the same auth/role-settling
  window as P1-03. Fix: gate the shell on auth-ready with a proper loading skeleton, and ensure the
  layout picker doesn't default to public chrome while auth resolves. Effort: M. Verify with P1-03.

### [x] P2-21 · Medium · Client project-accept address form not pre-filled from the PM's property
- The PM already entered the property address; the client's accept form makes them retype it
  (`project.property.address` is on file). Evidence: run D, M2. Fix: pre-fill, keep editable.
  Effort: S.

### [x] P2-22 · Low-Medium · No notification when a PM adds a tradesperson to their roster
- Roster add is a silent direct write; the tradesperson never learns future matching projects will
  route to them (run D, L2). Fix: notify on roster add (pairs with the P2-09 notification-gap
  theme). Effort: S.

### [x] P2-19 · Low-Medium · Accepted quote's projected start date never reaches the Schedule tab
- The quote agreed "Projected start: Jul 14" but the job's Schedule tab opens on the current week
  with nothing booked and no mention of the agreed date; the tradesperson re-finds it manually.
  The data is already structured (quotes carry proposedStartDate). Evidence: run C, L1. Fix:
  surface the agreed start on the Schedule tab (and consider pre-creating a tentative visit).
  Effort: S-M.

---

## Phase 3: Money-path robustness and ops (server-side edges)

> **Status (2026-07-08): ALL 12 shipped + deployed. Phase 3 complete.**
> P3-11 quote-status pin + P3-12 roster-remove confirm `74086b7`; P3-04
> upfront-refund cap give-back `d738e6f`; P3-02 upfront-fee commission + P3-05
> proportional reversal + P3-01 double-charge log `03a76ad`; P3-03 reverse-only
> owner netting `df8b9bb`; P3-09 rep earnings breakdown `095644b`; P3-07 admin
> vetting attribution `2f85d77`; P3-08 rep trust-doc tooling `98a678f`; P3-06
> admin queue truncation `c023a45`; P3-10 storage jobPosts path `3002d03`. Money
> policy (P3-02/05/08) implemented to MONETIZATION.md §10b.

### [x] P3-01 · Medium · Offline-mark + in-flight card race double-charges with only a bare log
- If a card PaymentIntent succeeds after the tradesperson marks the invoice paid offline, the
  webhook no-ops with a `warn`, money moved twice, nobody is flagged. The upfront path already
  detects this exact race and logs for admin review; mirror it.
- Evidence: `functions/src/payments/handlers/paymentIntent.ts:130-138` vs `upfrontFee.ts:102-116`.
  Effort: S-M. Longer term: an admin "payment anomalies" surface (pairs with P3-06).
- **Done `03a76ad`:** a `succeeded` transition landing on an already-settled invoice
  (paid/refunded/disputed/void) now `logger.error`s "double payment, admin review" with the
  chargeId, instead of the bare warn. Deployed with the stripeWebhook bundle.

### [x] P3-02 · Decision + fix · Medium · Upfront-fee platform revenue accrues no rep/PM commission
- The invoice path accrues both; the upfront path banks the platform portion and accrues neither
  (`handlers/upfrontFee.ts:82-135` vs `paymentIntent.ts:231-265`). On upfront-heavy jobs the rep/PM
  are shorted. Confirm intent (maybe upfront fees are deliberately house money) and either add the
  accrual or document the policy in MONETIZATION.md. Effort: S-M once decided.
- **Decided FULL accrual (MONETIZATION.md §10b); done `03a76ad`:** `handleUpfrontFeeSucceeded`
  accrues rep + PM commission on the upfront's `platformPortionCents`, keyed `upfront_<jobId>` so it
  coexists with the invoice entry, on both the flip and the offline-mark race; reversed
  proportionally on an upfront refund. accruePmServiceFee/reversePmServiceFee generalized to an
  arbitrary sourceRef. Deployed with stripeWebhook.

### [x] P3-03 · Medium · Refund after payout strands the negative balance forever
- Monthly netting iterates owners with current accruals only; a reversed entry for an owner who
  stopped earning never applies (`scheduledRepCommissionPayouts.ts:105-116`). Fix: include owners
  with unapplied reversed entries in the netting loop. Effort: M.
- **Done `df8b9bb`:** the payout loop now iterates the UNION of accrued + unapplied-reversed
  owners, so a reverse-only owner is netted (rolls over, reversals stay unapplied to offset a
  future accrual) and logged with accrued/reversed counts instead of silently dropped.

### [x] P3-04 · Low · Upfront refund keeps consuming the $99 service-fee cap
- `handleUpfrontRefund` records the refund but never decrements `serviceFeeCapUsedCents`, so the
  final invoice under-charges the platform (`chargeRefunded.ts:44-83`). Effort: S.

### [x] P3-05 · Policy decision · Low · Partial refunds retain full rep+PM commission
- Documented in code (`chargeRefunded.ts:230`) but no proportional policy. Decide and write it
  down (MONETIZATION.md), implement only if the decision says so.
- **Decided PROPORTIONAL (MONETIZATION.md §10b); done `03a76ad`:** reverseCommission /
  reversePmCommission take a `proportion` (cumulative refunded share); the reversal doc escalates in
  place and stays idempotent. chargeRefunded now reverses on every refund (not just full) at
  `amount_refunded / amount`. Pure computeReversalCents helper, unit-tested. Deployed with stripeWebhook.

### [x] P3-06 · Medium · Admin support queue silently truncates at 200 and can drop OPEN tickets
- `listSupportTickets` caps at the 200 most recent regardless of status; open tickets older than
  the cap vanish with no notice (`src/firebase/services/support.ts:64` +
  `AdminSupportView.vue:41-42`). Fix: status-scoped query or pagination. Same cap-with-no-notice on
  bug reports and error queues (`bugReports.ts:94`, `errorReporting.ts:83`), AdminJobs already has
  the right "showing most recent 300" pattern to copy. Effort: M.
- **Done `c023a45`:** each of the three queues now merges a status-scoped pull of every ACTIONABLE
  item (support: not closed; bugs: not fixed/wontfix; errors: unresolved) with the most-recent 300,
  via a shared mergeQueueDocs helper. Open items can no longer fall off the list. No composite index.

### [x] P3-07 · Medium · Admin cannot see or audit rep vetting work
- Vetting queue rows carry no region/assigned-rep attribution and the review header never shows
  `approvedBy` (`VettingQueueView.vue:52`, `ApplicationReviewView.vue:326`). A rep approval just
  makes the row vanish. Fix: surface region + rep on rows, approvedBy on the header. Effort: S-M.
- **Done `2f85d77`:** approveApplication now stamps approvedBy + approvedByRole; a shared
  useVettingAttribution composable resolves region/rep/approver ids to names, surfaced on the queue
  rows (pending + approved-not-live) and the review header.

### [x] P3-08 · Low-Medium · Rep application review lacks the trust-doc tooling admin has
- No insurance/WSIB cards, no registry-verify helper, raw new-tab links instead of the inline
  watermarked viewer (`SalesApplicationReviewView.vue:115-164` vs admin `:447-601`). If reps are
  meant to vet fully, port the components; if not, document the split. Effort: M.
- **Done `98a678f` (reps are FULL vetters, §10b):** getApplicationDetails now returns the
  insurance + WSIB docs (signed URLs + release signature) reps can't read via rules; the rep view
  gained the insurance/WSIB cards, the registry-verify helper, and the inline watermarked viewer.
  Read-only — approve/reject of these optional badges stays with admin (rep approveApplication
  gates go-live).

### [x] P3-09 · Low · Rep earnings: per-tradesperson breakdown computed but never rendered
- `summary.byTradie` exists (`repEarnings.ts:58`); the view shows only a count
  (`SalesRepPayoutsView.vue:82`). Effort: S.
- **Done `095644b`:** an "Earnings by tradesperson" card lists each tradesperson's lifetime net
  (refunds netted, negatives flagged), names resolved from the public profile with a uid fallback.

### [x] P3-10 · Low · Storage: jobPosts photo path writable by any signed-in user
- `storage.rules:211-214` (pre-doc temp-uuid tradeoff, acknowledged in a comment). Mitigate with a
  tighter prefix or finalize-time cleanup. Effort: M.
- **Done `3002d03`:** photos now upload to `jobPosts/{uid}/{tempId}/photos/...` and the storage
  write is gated on `request.auth.uid == ownerId`, so a user can only write under their own prefix.
  Paths are stored verbatim + copied from on accept, so the shape change is transparent.

### [x] P3-11 · Low · Quotes rule lets a tradesperson direct-write status: accepted
- Canonical accept path is unaffected; still pin `status` server-side
  (`firestore.rules:1343-1349`). Effort: S.

### [x] P3-12 · Low · Roster remove is instant; add notifies nobody
- `PmTradesView.vue:50,61`, confirm on remove (fat-finger at 375px), notify the tradesperson on
  add. Effort: S.

<!-- Run C/D money-path live findings integrate here -->

---

## Phase 4: Consistency, a11y, PWA, copy polish

### [ ] P4-01 · Medium · Currency renders at least 11 different ad-hoc ways
- Inline `$${Math.round(cents/100).toLocaleString("en-CA")}` variants drop cents while
  `formatMoneyCents` keeps them; the same dollar amount reads differently across feed, dashboard,
  applicant card, and invoice. Evidence: `utils/format.ts:8` vs `BrowseJobsView.vue:178`,
  `ClientDashboard.vue:127`, `PostJobView.vue:333`, `JobPostDetailView.vue:303`,
  `ApplicantCard.vue:79`, `MyApplicationsList.vue:112`, `InsuranceUploadCard.vue:76`,
  `ApplicationReviewView.vue:343`, and more. Fix: route everything through the one formatter;
  decide cents-always or cents-when-nonzero once. Effort: M.

### [ ] P4-02 · Medium · Em dashes throughout user-facing copy (established no-em-dash rule)
- Confirmed in real strings, not comments: `AccountView.vue:377,709,758`, `SignUpView.vue:243`
  (legal consent line), `InviteLandingView.vue:45`, `JobPostDetailView.vue:779`,
  `TradieProfileView.vue:484,520` (share + SEO copy), the wizard control "Skip, fill out the whole
  form" (`PostJobView.vue:688`, `RequestQuoteView.vue:614`), `QuoteSheet.vue:169-170` ("Send quote
 , $X"), `AddExpenseDialog.vue:271,286`, `BrowseJobsView.vue:280`, `TradieStatusBanner.vue:173`,
  `PayoutsPanel.vue:160`, plus `/pricing`'s title. Fix: one sweep, replace with periods/commas/
  colons; add a lint-ish grep to the QA checklist so it stays fixed. Effort: S-M.

### [ ] P4-03 · Medium · A11y: icon-only buttons with no accessible name
- e.g. `AvailabilityEditor.vue:61` (remove), `ScheduleTab.vue:247` (delete), PrimeVue does not
  auto-label. Sweep every `icon=` Button without `label`/`aria-label`; also check custom overlays
  (RoleSwitchOverlay, ImageLightbox) for focus trapping and the status timeline for color-only
  state. Effort: M.

### [ ] P4-04 · Medium · PWA: offline is a spinner graveyard; iOS meta missing; no maskable icon
- `public/offline.html` exists but is never wired (GenerateSW); data views just fail. No
  `apple-mobile-web-app-*` meta (degraded iOS home-screen experience); manifest has no
  `purpose: "maskable"` icon (plated icon on Android); stale orphan `public/manifest.json` ("App")
  should be deleted. Evidence: `vite.config.ts:83-104`, `index.html`. Effort: M (or S if you decide
  offline stays spinner-based and just delete offline.html + add the meta/icon).

### [ ] P4-05 · Low · Dev console noise: manifest.webmanifest syntax error on every route
- vite-plugin-pwa has no `devOptions.enabled`, so dev serves index.html for the manifest URL; every
  QA session logs 2 errors per page. Prod is unaffected. Fix: enable devOptions or accept and note
  it in the runbook (currently done). Effort: S.

### [ ] P4-06 · Medium · Help Center: PM content mis-tagged, supplies feature undocumented
- `HelpAudience` union has no `projectManager`, so ~11 PM FAQs are tagged `client` (a client
  filtering "for you" sees PM manage content; the PM article itself is inconsistently `all`).
  Supplies marketplace has zero help coverage. Evidence: `src/firebase/interfaces.ts:2576`,
  `src/data/help.ts:578,701-765`. Fix: extend the union + filter, retag, add a supplies FAQ.
  Effort: S-M.

### [ ] P4-07 · Medium · QA checklist misses the core client↔tradie lifecycle seams
- No trackable items for change orders, site visits, cancel/postpone, supplies, expenses,
  upfront fee, recurring auto-run (only the Pro gate), `/jobs/new` invite jobs, vouches, Google
  reviews connect, `/reports`, tradesperson Clients CRM, or admin prospects/regions/site-content/
  rebates/bug-triage. Add stable-id items per role (`src/data/qaChecklist.ts:437-486`) + matching
  QA_HAPPY_PATHS sections. Effort: M.

### [ ] P4-08 · Low · Shared EmptyState component
- Empty states are hand-rolled per view; extract once P2's new placeholders land (3+ repeats rule).
  Effort: M.

### [ ] P4-09 · Low · Hardcoded hex colors in app views bypass design tokens
- 368 hits across 63 SFCs; brand/pitch mocks are fine, app views aren't (OnboardingWizard 25,
  TradieProfileView 12). Migrate opportunistically per-file when touched; don't big-bang. Effort:
  ongoing.

### [ ] P4-10 · Low · Small live-run cosmetics batch
- Home page keeps an 8px horizontal scroll despite the overflow-x guard (run A LOW-2; check `html`
  vs `body` clip). Pricing title renders "Pricing — Blue Seal | Blue Seal" (run A LOW-3;
  `useSeo({ title: "Pricing" })`). Trades combobox keeps its invalid ring after a valid pick (run B
  L2). Dead "View document" button on self-declared certs in admin review (run B L1). Invoice pay
  view renders an empty 12rem Stripe container on init failure (client scan). MutualReviewCard
  drops parent-passed `class` (multi-root component; Vue warns every render, real styling bug,
  run C L3). Receipt view is thin: no line items, tradesperson identity, or payment date/method
  (run C L4). "Line (incl. tax)" header reads wrong while tax is $0 (run C L5; resolves with
  P1-11). `/admin/business-cards` has 11px horizontal overflow at 375px (run D L1; admin is
  desktop-first so low). Effort: S each.

<!-- Run C/D polish findings integrate here -->

---

## Phase 5: Docs and spec truth-up (cheap, high leverage for future sessions)

### [ ] P5-01 · Medium · design.md still describes the retired 12% fee model
- §7/§8 say "Stripe Connect, 12% commission" and "AI paid-gate removed"; live reality is the 5%
  client fee capped at $99 + AI behind Pro (MONETIZATION.md:25 vs design.md:650,679). §5.9 and §7
  now contradict each other inside one document. Rewrite the payment lines; delete the stale AI
  note. MONETIZATION.md:175 already flagged this and it never happened. Effort: S.

### [ ] P5-02 · Medium · Shipped systems missing from design.md entirely
- Insurance + WSIB + uninsured-waiver gate (legally significant, fully live), peer vouches,
  supplies marketplace, recurring invoices (still listed as v1.1 backlog). Add sections or link
  specs; reclassify. Effort: M.

### [ ] P5-03 · Low · design.md §14 open questions + §2 roles are stale
- Q1 launch region (Okanagan is locked), Q2 AI price ($29 shipped vs "suggest $39"), §2 says three
  roles while five view-roles are live. Strike through with resolutions per the documented
  convention. Effort: S.

### [ ] P5-04 · Medium · CLAUDE.md commands drift
- `npm run dev:full` and `npm run typecheck` no longer exist (typecheck now lives inside `build`);
  `concurrently` is an unused devDependency; missing mentions of `test:rules`, `test:e2e`,
  `functions:build`. A session following the doc verbatim fails its first command. Effort: S.

### [ ] P5-05 · Medium · QA_PLAYWRIGHT.md is a release behind the product
- Route list lacks all 11 PM routes, all 5+ sales routes, cities/reports/clients/featured-by-pms/
  upfront-pay/claim flows and 9 admin views; "three roles" framing predates PM/sales/qa. Also: the
  documented seeding path is a chicken-and-egg (`grantAllRolesForAdminTesting` requires admin) ,
  runs A/B had to bootstrap via an Admin SDK script and the Auth-emulator UI for email-verify.
  Regenerate the route list from the router, fix the seeding recipe (commit a
  `scripts/emulator-seed.mjs`), note the Stripe-test-mode reality and the manifest dev noise.
  Effort: M.

### [ ] P5-09 · Medium · Add a lint rule banning .optional() without .nullable() on callable inputs
- Two production-breaking bugs today (P0-01, P0-02) had the identical root cause: the callable SDK
  sends unset object keys as `null`, and a bare Zod `.optional()` rejects `null`. A custom ESLint
  rule (or a shared `optionalNullable()` helper used everywhere in `functions/src/**` input
  schemas) would make a third instance impossible to ship. The triage sweep's full verdict table
  lives in the audit notes; adopt the helper as schemas are touched. Effort: M for the rule, S per
  schema to migrate opportunistically.

### [ ] P5-06 · Low · Receipt OCR logs under the wrong aiUsage tool
- `parseReceipt.ts:164` logs `tool: "diagnose"` (schema lacks "receipt"), inflating diagnose stats
  and hiding free-tier OCR volume. Add the enum value + log it. Effort: S.

### [ ] P5-07 · Low · Legacy AI callables decision
- `aiDiagnose`/`aiQuote`/`aiSummarize` still exported months after being "slated for removal"
  (design.md:418, `functions/src/index.ts:205`). Remove (and deploy the deletion) or un-deprecate.
  Effort: S.

### [ ] P5-08 · Decision · ICS calendar export is specced as MVP but does not exist
- design.md:374,864 promise it; zero implementation. Build it or move it to v1.1 in the spec.

---

## Decisions Johnny should make (not bugs; product calls surfaced by the audit)

1. **Photo-required gate on intake:** both request-quote and post-job hard-require a photo; fine
   for most trades, blocks legitimately photo-less jobs. Add a "no photo to add" escape? (P2 sized
   S once decided.)
2. **Upfront-fee commission policy** (P3-02) and **partial-refund commission policy** (P3-05).
3. **Rep vetting depth** (P3-08): are reps full vetters (port the admin tooling) or pre-screeners?
4. **Dark mode:** effectively absent; fine, just never claim it. Decide the stance once.
5. **Pro gate surfaces:** tab-level gates (Clients, Reports) link to /pricing with thin copy while
   AI features get the value-selling PaywallDialog; unify or accept the split deliberately.
6. **Sales-rep help category:** invite-only role with zero help content; internal-only docs or a
   public category?

---

## What was NOT covered (honest coverage notes)

- Live runs used the Firebase emulator suite; Stripe ran in real test mode but WITHOUT webhook
  forwarding, so webhook-driven state transitions (invoice → paid via card) were exercised only
  code-side, not live. Run C additionally could not reach the card-payment UI at all because the
  QA tradesperson never completed Stripe Connect payout onboarding (the invoice pay view correctly
  offers offline-only in that case, with clear copy). Closing this gap needs: a payout-onboarded
  test tradesperson + `stripe listen --forward-to localhost:5001/...` (worth adding both to the
  runbook). The offline path was verified fully, including its two-party confirm.
- Verified working and explicitly NOT gaps (run C): both uninsured waivers (client + tradesperson,
  checkbox + signature dual gate), AI Pro paywall grace, blind mutual reviews (hidden until both
  submit, correct reveal attribution), quote/invoice line-item math, and 375px fit on the quote
  sheet, invoice preview, and invoice tables.
- Push notifications (FCM), WhatsApp (deliberately dormant), and real email delivery (Resend) were
  not live-tested; email/notification templates were reviewed code-side only.
- Google Business connect, data export, account deletion, dispute admin processing, rebate
  programs, prospects outreach sends, and the PM public card/QR were reviewed code-side but not
  driven end-to-end in the browser this round (run D covers a subset; its Untested list is the
  source of truth).
- Per-run Untested sections in the four audit files list the finer-grained skips (site-visit-first
  and chat-first application modes, AI draft buttons, referral flows, insurance/WSIB submission).
- Load/performance, cross-browser (Chromium only), and real-device iOS/Android testing were out of
  scope.

---

## Suggested phase → session mapping

- **Phase 0 is already done** (both Criticals fixed, deployed, verified, committed during the
  audit). Its only open follow-ups are small: the role-aware self-heal (P0-01), the visible
  error-on-callable-failure treatment (P0-02), and the P5-09 lint guard.
- **Session 1 (P1):** P1-01, P1-02, P1-04, P1-05, P1-07, P1-08 are each S/S-M and independent;
  P1-03 (auth latch) deserves its own focused session with the full acceptance list; P1-06 + P1-10
  pair well (trust + tests); P1-11 (invoice tax) is its own careful M with a unit test. Deploy
  functions once at the end of the session, targeted.
- **Session 2 (P2):** the client/tradie UX batch (P2-01..05, P2-11..14), the job-detail trust batch
  (P2-15..18), then the PM/notification batch (P2-06..10).
- **Session 3 (P3):** money edges first (P3-01..05, small, high-trust), then admin ops
  (P3-06..09).
- **Session 4 (P4+P5):** consistency sweeps and the docs truth-up; P5 items are ideal warm-up
  tasks at the start of any session.

Re-run the relevant `docs/qa-*-audit.md` acceptance checklists in the browser after each phase.
