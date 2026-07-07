# QA audit — Tradesperson journey (run B)

**Scope:** Signup → onboarding wizard → pending-vetting state → admin approval → marketplace apply, as a plain `tradesperson` account (not the all-roles admin). Primary viewport 375×667, spot-checked 1440.
**Date:** 2026-07-07. **Tester:** qa-runner (Playwright MCP against local emulators, `blueseal-762af`).
**Accounts used:** `qa-tradie@blueseal.test` (new, created this run), `qa-client@blueseal.test` (existing, plain client), `qa-admin@blueseal.test` (existing, all roles). Password for all: `QaPass!2026`.

---

## Top 3 to fix first

1. **Admin "Approve everything" has zero confirmation** (`/admin/applications/:uid`) — one click sets a tradesperson fully live to the public, including one with a **self-declared no formal certification**, with no "are you sure?" step. Given manual cert+ID vetting is Blue Seal's entire trust proposition (per CLAUDE.md: "not a self-serve marketplace"), this is the one guardrail that should not be a misclick away. *Fix: add a confirm dialog, especially when any cert on the application is self-declared/no-file.*
2. **Fixed bottom step-nav intercepts the "Mark as no certification" button at 375px** (onboarding → Documents tab). The button's bottom edge sits flush with the viewport height, directly under the "Back / Next: Submit" bar. A direct tap doesn't register (reproduced twice); only works after scrolling the button further up. A real user could easily mis-tap "Next: Submit" instead and skip the certification declaration entirely. *Fix: bottom padding/scroll-margin on the expanded cert panel so its action button always clears the fixed nav.*
3. **Email verification is a hard, unsignposted blocker at the very last wizard step.** All 7 onboarding steps complete normally; `submitForVetting` only then rejects with 400 `FAILED_PRECONDITION: Verify your email before submitting your profile for review.` The "Confirm your email" banner is visible throughout, but nothing on the Submit/Review step itself says submission requires it. A real user finishes a long form before hitting this wall. *Fix: surface the requirement on the Submit step itself (banner or disabled button + tooltip), not just as a top-of-page banner unrelated to the button.*

---

## Signup regression check — explicit verdict: **PASSED**

Signed up `qa-tradie@blueseal.test` via `/sign-up?as=tradesperson` at 375px. `provisionAccount` returned **200 OK** (no 400), the account received `roles: ["tradesperson","client"]`, and the app landed on `/onboarding` (not bounced to Home, not client-only). No new console errors beyond the pre-existing manifest noise (see Low #4). The run-A Zod null-referral-fields fix holds.

## Certification "Other / no formal cert" regression check — explicit verdict: **PASSED (no dead-end)**

On the Documents tab, selecting **"I don't have a formal certification for this trade"** from the Certification dropdown now shows an explanatory alert ("the vetting team will review your application manually...") and a **"Mark as no certification"** button. Clicking it (once scrolled clear of the fixed nav — see High/Medium #2 below) completes cleanly: the trade badge updates to "No formal cert", the section collapses, and re-expanding shows a reversible "You declared no formal certification... [Remove declaration]" state with its own confirm dialog on removal. No dead-end, no console/network errors. The commit `6bd8480` fix works end-to-end.

---

## High

### H1 — Admin "Approve everything" approves live with zero confirmation
- **Where:** `/admin/applications/:uid`, global action bar.
- **What happened:** The button's own caption reads "One click approves every pending cert + ID and sets their profile **live**." Clicked it — no confirm dialog, immediately fired `approveApplication` (200 OK) and returned to the vetting queue ("Queue clear."). This is true even when the only certification on file is self-declared with no uploaded document.
- **Impact:** A misclick, or clicking through a long queue on autopilot, permanently approves and publicly lists a tradesperson — including one with no verified credential — with no undo step in the UI.
- **Fix suggestion:** Confirm dialog before `approveApplication`, or at minimum when any line item is self-declared/no-file.

---

## Medium

### M1 — Fixed bottom nav intercepts "Mark as no certification" at 375px
- **Where:** Onboarding → Documents tab → expanded certification panel.
- **Evidence:** `getBoundingClientRect()` on the button showed `bottom: 667.04` against `viewport height: 667` — the button sits exactly behind the fixed "Back / Next: Submit" bar. Playwright's auto-retrying click failed for 5s with `<Next: Submit> ... subtree intercepts pointer events`. Succeeded only after `scrollIntoView({block:'center'})`. Reproduced on two separate attempts (once per trade-selection cycle).
- **Impact:** first-tap failure on the one button that completes the no-cert declaration; a real user could tap through to "Next: Submit" by mistake instead.
- **Fix suggestion:** extra bottom padding/scroll-margin inside the expanded cert card so its action button always clears the fixed step-nav.

### M2 — Email verification requirement not signposted on the Submit step itself
- See Top 3 #3 above. The persistent top banner ("Confirm your email" / "Resend email") is present throughout the wizard, so the information technically isn't hidden — but it's never connected to the "Submit for review" action until the button is clicked and a 400 comes back. (To be clear: once it does fail, the on-screen inline alert is clear and well-worded — "Verify your email before submitting your profile for review." This is a signposting gap, not a silent failure.)

### M3 — Pending-vetting tradesperson dashboard (List view) is genuinely near-blank
- **Where:** `/dashboard/tradie`, List tab, while `qa-tradie` was pending approval.
- **What renders:** a clear "Application under review — ~48 hours" status banner, plus an insurance upsell banner ("You're not insured yet..."). Below that: **nothing** — no "No jobs yet, check back after approval" placeholder, just empty white space down to the bottom nav (confirmed via screenshot).
- **Contrast:** `/jobs/browse` and `/account` both handle the pending state well — `/jobs/browse` shows an explicit "Vetting in progress. You'll be able to browse and apply... (1-2 business days)" message; `/account` is fully functional (profile edit, roles, privacy, sign out all present). So the suspected "near-blank dead-end" is real, but scoped specifically to the Jobs List tab, not the whole pending experience.
- **Fix suggestion:** add a placeholder message to the empty Jobs list consistent with the other pending-state screens.

---

## Low

### L1 — Dead "View document" button for self-declared (no-file) certifications
- **Where:** `/admin/applications/:uid`, Certifications card, when the cert entry is `Self-declared • No formal certification — self-declared`.
- **What happened:** "View document" button is still rendered and clickable even though no file was ever uploaded. Clicking it does nothing — no lightbox, no new tab, no console error. Not misleading about approval substance (the "Self-declared" tag is directly above it), just a decorative dead control.

### L2 — Stale invalid-styling on Trades primary-trade combobox
- **Where:** Onboarding → Trades tab.
- **What happened:** After picking "Electrician" from the Primary trade dropdown, the field kept its red `[invalid]` state and the "Pick your primary trade." error text didn't clear, even though the value was accepted (clicking "Next: Pricing" advanced without complaint). Cosmetic only; does not block progression.

### L3 — Notification copy overstates self-declared certifications
- **Where:** In-app notification after admin approval: "Certification approved — Your electrician certification was verified. It's now showing on your public profile."
- **Issue:** `qa-tradie` had explicitly declared **no** formal certification; nothing was actually "verified" in the credentialing sense — the admin approved despite the declared absence. Copy should differ for the self-declared-no-cert path (e.g., "Your application was approved" rather than implying a credential check occurred).

### L4 — Pre-existing console noise on every route (unrelated to this scope)
- `[ERROR] Manifest: Line: 1, column: 1, Syntax error @ manifest.webmanifest` fires twice on every page load throughout the whole session (all routes, all roles). Likely a dev-server content-type/parse issue with the PWA manifest, not caused by anything in this run. Flagging since the runbook asks to watch console on every route — did not chase further as it's outside tradesperson-journey scope.

### L5 — Sign-in `?redirect=` param not honored after a forced sign-out
- **Where:** After editing `qa-tradie`'s email-verified flag in the Auth Emulator (which invalidates the session and force-signs-out), the app redirected to `/sign-in?redirect=/onboarding`. Signing in from there landed on Home (`/`), not `/onboarding`. Observed once, not re-tested for reproducibility outside that specific forced-signout path — flagging as a lead, not a confirmed bug.

---

## Untested (ran out of time / explicitly out of scope this run)

- Application modes other than "Send a quote" — **"Site visit first"** and **"Chat first"** tabs on the apply form were not exercised.
- **"Draft with AI"** quote-builder assist button.
- **"Refer this job"** / "Refer to another tradesperson" flows.
- Full desktop 1440 sweep — only `/my-applications` was spot-checked at 1440 (looked clean: side-nav shell, cards well-contained, no stretching). Onboarding wizard and admin `ApplicationReview` were not re-checked at 1440 (both were approved/completed before I could double back).
- Privacy & account tab actions beyond Sign out: **Change email**, **push-notification toggle**, **Export my data**, **Delete account** — all present in the UI, none exercised.
- Actual submission of the **Insurance** / **WSIB** cards on onboarding (both render correctly with disabled-until-valid Submit buttons, but I didn't complete a submission).
- **"Find my business"** claim-listing autofill entry point on onboarding.
- Portfolio photos upload (optional, skipped for time).
- **Recommendations**: only the empty state was seen (`/account/recommendations` — "0 accepted · 0 pending · 0 awaiting reply"); the "Recommend a tradesperson" flow itself wasn't exercised.

---

## Notes / corrections to task assumptions

- **Stripe Connect is NOT absent in the emulator.** Clicking "Start Stripe setup" on `/payouts` redirected to a real, live **Stripe test-mode sandbox** (`connect.stripe.com/setup/e/...`, page titled "[Test] Blue Seal sandbox"). This contradicts the expected-limitation note that Stripe would fail/no-op locally — it's actually wired to a real (test) Stripe Connect account. I did not proceed into the external Stripe form (out of scope, and no reason to create artifacts in a third-party test account). Worth knowing for future QA runs: don't assume payouts is a dead end, and don't casually click through it either.
- **Resend/email verification:** confirmed unconfigured as expected — `sendVerificationEmail` callable returns 200 (no error), but no email is delivered in-app-visibly. To complete the onboarding regression check end-to-end, I used the **Firebase Auth Emulator UI** (`localhost:4000/auth`, "Edit user" → "Verified email?" toggle) to mark `qa-tradie`'s email verified — a legitimate emulator-only testing path, not a product feature. This is worth calling out explicitly since it's the only way past M2/the Submit gate in this environment; noting it here so future QA runs don't waste time hunting for an in-app path.
- **Service-area radius cap confirmed at 200 km** (onboarding Area tab slider; `aria-valuemin=1`, `aria-valuemax=200`), matching the existing project note. **Job-board browse-radius filter caps at 500 km** (separate control on `/jobs/browse`), also matching the existing project note that the feed radius was already extended independently of the profile radius.
- **Save-and-resume works correctly.** Reloading mid-wizard (tested at the Hours tab, step 5) preserved all previously entered field data (bio, hourly rate, etc.) and restored the last-active tab after a brief re-render. Not a bug — confirms the feature works as intended.
- **No stale-claims friction after vetting approval.** After admin approval, a plain sign-out/sign-in (no special steps, no waiting) was sufficient for `qa-tradie` to see the fully live dashboard (toolbar, "No jobs yet" empty state, 3 new notifications: ID verified / Certification approved / You're approved). Approval appears to be Firestore-doc-driven rather than custom-claims-driven, so there's no token-refresh gymnastics required for testers or real users.
- The full itemized quote application (line items — hourly/flat/materials —, tax, discount, upfront fee, valid-until date, projected start date/duration, terms) worked cleanly end to end; live tax/total math was hand-verified ($255 + $65 = $320 subtotal, ×13% tax = $41.60, total $361.60) and matched exactly on both the apply form and the resulting `/my-applications` card.

---

## Acceptance checklist for this audit

- [x] Signup regression (null referral fields) re-verified end-to-end — PASSED.
- [x] Cert "Other / no formal cert" dead-end regression re-verified end-to-end — PASSED, no dead-end.
- [x] Onboarding wizard walked step-by-step at 375px with field validation checks.
- [x] Photo/document upload exercised (photo ID + job-post photo) using repo `public/` PNGs.
- [x] Service-area radius max confirmed (200 km).
- [x] Save-and-resume verified via mid-wizard reload.
- [x] Insurance/WSIB upload cards confirmed present and validating (not submitted).
- [x] Final submit for review completed (after emulator-only email-verify workaround).
- [x] Pending-vetting state described for `/dashboard/tradie`, `/jobs/browse`, `/account`.
- [x] Admin vetting queue → ApplicationReview → Approve everything exercised; one-click-no-confirm behavior confirmed.
- [x] Post-approval dashboard liveness and stale-claims behavior confirmed.
- [x] Fresh open job post created (qa-client) and applied to (qa-tradie) with a full itemized quote at 375px.
- [x] `/my-applications` state confirmed Pending, left in that state for run C.
- [x] Recommendations empty state checked; Payouts checked (Stripe found live, not absent — noted).
- [x] Horizontal-overflow spot-checked on Basics tab, apply-quote form, and generally via `scrollWidth`/`clientWidth` — none found.
- [x] 1440 spot-check done on `/my-applications` — clean.
- [x] Ended signed out at `localhost:5173`.

**Open for run C:** `qa-tradie`'s application to job `pWUcfSfCRSWvts2GiQRP` ("QA test job - replace a faulty outlet...") is live and **Pending**, ready for `qa-client` to compare/accept.
