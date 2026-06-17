# QA happy-paths run — findings

Autonomous walk → discover → log → fix of the happy paths (`docs/QA_HAPPY_PATHS.md`), driven by
the headless Playwright harness in `e2e/happy-paths/` against the deployed **test-mode** site
(`https://blueseal-762af.web.app`), signed in as `clientqa@` (client) and `tradieqa@`
(tradesperson + admin + qa).

Status legend: **open** → **fixed** (code changed, not yet re-verified in browser) → **verified**
(driver re-run clean).

## Top to fix first

1. ~~**PAY-2** — the client's offline "Confirm payment sent" is invisible to both parties.~~
   **FIXED + deployed (`947a071`).**
2. ~~**PAY-1** — offline-payment dialog points to a "Pay by card" option that isn't there.~~
   **FIXED (`64cd8d5`).**
3. ~~**UX-4** — a job with a pending applicant is hidden behind the non-default "Posted jobs" tab
   with no count badge.~~ **FIXED (`66c9a27`).**
4. ~~**UX-3** — the post-a-job wizard throws away the Step-1 natural-language description.~~
   **FIXED (`76d0259`).**
5. ~~**UX-6** — quote/invoice line totals are tax-inclusive but shown alongside a pre-tax
   Subtotal + Tax.~~ **FIXED (`5792ca7`).**
6. ~~**UX-5** — posted-jobs cards lack applicant counts; cancelled posts never filter.~~
   **FIXED (`66c9a27`).**

_All findings from the flagship walk are now fixed. Re-verify the client-facing ones on the next
hosting deploy._

## Critical
_none yet_

## High
_none yet_

## Medium

### PAY-2 — Client "Confirm payment sent" registers on the backend but is invisible to both sides — **fixed + deployed (pending live re-verify)**
- **Fix (commit `947a071`, deployed `functions:clientMarkPaid` + `functions:clientApproveJob`):**
  the nudge now records a **non-authoritative** `clientReportedPaidAt` on the job (status
  unchanged — `markJobPaid` is still what completes the job). Both invoice cards read it from the
  job they already hold: client sees **"Payment marked as sent — waiting for the tradesperson to
  confirm receipt"** (replaces the re-clickable pay button); tradesperson's card becomes **"Client
  says they've paid — confirm receipt."** `clientApproveJob` resets the flag to `null` on each
  entry to `awaiting_payment` so a re-invoice cycle starts clean. No rules change. Re-verify the
  two-sided handshake on the next hosting deploy.
- _Original report below._

- **Where:** job Invoice tab, offline payment path (tradesperson with no Stripe payout connected).
- **Repro:** client → Approve & pay → "I've paid the tradesperson" → check the box → **Confirm
  payment sent**.
- **Evidence:** the callable **`clientMarkPaid` returns HTTP 200** (verified in the network log;
  no console error). Yet:
  - **Client side:** the invoice stays **"Awaiting payment"** with the same actionable
    **"I've paid the tradesperson"** button — no "you marked this paid / awaiting confirmation"
    acknowledgment, and the button is immediately re-clickable (re-fires the callable). Persists
    across reload.
  - **Tradesperson side:** the invoice shows a **generic "Payment received? … Mark as paid"** with
    chip **"sent"** — **no "client reported they paid $X — confirm receipt"** signal at all.
  - Net: the intended handshake from the dialog copy ("let them know here — they'll confirm
    receipt") produces **no visible effect for either party.**
- **Impact:** not a hard blocker — the tradesperson can still hit "Mark as paid" to complete the
  job — but the client gets zero feedback their action worked (looks broken, invites re-clicks) and
  the tradesperson has no idea the client signalled payment. Medium.
- **Suggested fix:** surface the client's mark — client side: switch the CTA to a disabled
  "Payment marked sent · awaiting confirmation" state; tradesperson side: show a "Client reported
  they paid $X on <date> — confirm you received it" prompt. Confirm what `clientMarkPaid` actually
  writes and that both views read it. (Worth a code check of the callable + the invoice-status
  rendering.)

### PAY-1 — Offline-payment dialog points to a "Pay by card" option that isn't there — **fixed (pending hosting deploy + live re-verify)**
- **Fix:** `PayInvoiceDialog.vue` now takes an `invoicePayable` prop (threaded from
  `ClientInvoiceCard.vue`, same flag that gates the real "Pay by card" button) and only shows the
  "Prefer to pay by card…" sentence when card pay is actually available. Lint + build green.
  Client-only display change — no Firebase deploy. Re-verify after the next hosting deploy.
- **Where:** the "Paid by e-transfer or cash?" dialog (offline path), when the tradesperson hasn't
  connected Stripe payouts.
- **Evidence:** the dialog body reads "Prefer to pay by card instead? Close this and choose **Pay
  by card**." But on the invoice there is **only** an "I've paid the tradesperson" button — **no
  "Pay by card"** anywhere (confirmed: no card text on the page). Card pay is gated on the
  tradesperson completing payout onboarding (Quinn skipped it), so the unconditional copy sends the
  client looking for a control that doesn't exist.
- **Suggested fix:** make the "Pay by card" reference conditional on the tradesperson actually
  offering card pay; otherwise drop that sentence (and ideally explain card pay isn't available
  because the pro hasn't set up payouts).

### UX-4 — Client dashboard default tab hides a posted job that needs action — **fixed (`66c9a27`, pending hosting deploy)**
- **Fix:** the "Posted jobs" tab now carries a live applicant-count badge (from each open post's
  `jobPostMeta.applicationCount`), the "My jobs" empty state points at open posts ("You have N open
  job posts with M applicants waiting →"), and each open post card shows its applicant count. No
  backend change.
- **Where:** `/dashboard/client` → "My jobs" (default) vs "Posted jobs" tabs.
- **Evidence:** Right after the client posts a job AND a tradesperson applies, the default
  **"My jobs"** tab shows the empty state *"No active jobs. Post a job to get bids…"*. The posted
  job — now with **1 pending applicant the client must review/accept** — sits only under the
  separate **"Posted jobs"** tab, which has **no count/badge**. The only hint that action is
  needed is the notification bell (1 unread). A real client could easily miss that a vetted pro is
  waiting on them.
- **Suggested fix:** surface posted jobs with applicants on the default tab (or add an
  applicant-count badge to the "Posted jobs" tab, and/or an "X applicants — review" call-out on the
  card). At minimum, don't show "No active jobs" when the client has an open post with applicants.

### UX-3 — Post-a-job wizard discards the Step-1 natural-language description — **fixed (`76d0259`, pending hosting deploy)**
- **Fix:** extracted `seedFromDescribe()` and also run it when leaving step 1, so the describe text
  seeds the title/description whether the trade was set via a suggestion chip OR the dropdown (the
  dropdown path previously dropped it). Idempotent — only fills blanks.
- **Where:** `/jobs/post` guided wizard, Step 1 → Step 2.
- **Evidence:** Step 1 ("What do you need done?") accepts a free-text description and uses it to
  **detect the trade** (works great — "Sounds like you need: Painter…"). But on Continue, Step 2
  ("Tell us about the job") opens with **an empty title and empty "Describe the job" (0/2000)** —
  the sentence the client just wrote is gone, so they retype it. The same text could also seed the
  intake "Anything else?" / surface-prep answers.
- **Suggested fix:** carry the Step-1 text into Step 2's description (and optionally propose a
  title from it). Low-risk, high-polish — it's the first thing a client does.

## Low

### UX-6 — Quote line totals are tax-inclusive but shown with a separate pre-tax Subtotal + Tax — **fixed (`5792ca7`, pending hosting deploy)**
- **Fix:** relabeled the column "Line" → "Line (incl. tax)" in QuoteBreakdown + InvoiceBreakdown
  and "Line total" → "Line total (incl. tax)" in the PDF, so the tax-inclusive lines are
  self-explanatory against the pre-tax Subtotal. The math was already correct and intentional
  (`pdfRender.ts`); only the header was ambiguous.
- **Where:** quote table on the tradesperson application view AND the client's "View full quote"
  (job-post detail) — same component both sides.
- **Evidence:** a $850 flat-rate line + $220 materials line (13% tax) renders line "Line" values
  of **$960.50** and **$248.60** (i.e. tax-*inclusive*). Those sum to the **Total $1,209.10**, yet
  the summary directly below shows **Subtotal $1,070.00 / Tax $139.10 / Total $1,209.10**. So the
  line items already include tax, then tax is itemized again — a reader can't reconcile the lines
  to the Subtotal and it looks like double tax.
- **Suggested fix:** either show **pre-tax** amounts in the line column (lines then sum to
  Subtotal, + Tax = Total), or relabel the column "Line (incl. tax)" and drop/clarify the separate
  Subtotal+Tax. A display-only change; the math is correct.

### UX-5 — Posted-jobs list: no applicant count on cards; cancelled posts never filter out — **fixed (`66c9a27`, pending hosting deploy)**
- **Fix:** each open post card now shows its live applicant count (`jobPostMeta.applicationCount`),
  highlighted when someone's applied; closed/cancelled/expired posts are collapsed behind a "Show
  closed (N)" toggle instead of cluttering the list.
- **Where:** `/dashboard/client` → "Posted jobs".
- **Evidence:** each card shows status ("open"/"cancelled") but **not how many applicants** it has,
  so the client can't tell at a glance which post has a quote waiting. Separately, **cancelled**
  posts accumulate in the same list with no filter/collapse (a real repost-heavy client would see a
  long noisy list). (Lots of cancelled "QA Plumber" entries here are our own harness test data.)
- **Suggested fix:** add an applicant count to each card; default-hide or group cancelled posts
  behind a filter.

### NOTE — Draft-with-AI (non-Pro) logs an HTTP 400 from `aiDraftQuote` — **expected, not a bug**
- **Where:** quote composer → "Draft with AI" as a non-Pro tradesperson.
- **Evidence:** the callable throws `BLUESEAL_PRO_REQUIRED`, surfaced as `POST .../aiDraftQuote 400`
  in console; the client catches it and shows the **Pro paywall** correctly ("Unlock the full
  toolkit"). This is how Firebase callables return a thrown `HttpsError` — the SDK logs the HTTP
  failure regardless. No user-facing breakage. Flagged only so it isn't mistaken for an error in
  prod monitoring.

### L2 — Address fields use the deprecated `google.maps.places.Autocomplete` API — **open**
- **Where:** any address field (Account → location, /jobs/post, /request, onboarding) — 2 console
  warnings per page that loads Maps.
- **Evidence:** `google.maps.places.Autocomplete` is "not available to new customers" as of
  2025-03-01; Google recommends `PlaceAutocompleteElement`. Still works (bug-fixed, ≥12 months
  notice before any removal), so this is **tech debt / future-proofing**, not a break.
- **Fix (deferred):** migrate `useGoogleMaps` (`src/composables/useGoogleMaps.ts`) + the address
  fields to `PlaceAutocompleteElement`. Non-trivial (touches every address input) — flagged for a
  deliberate change, not a mid-QA hotfix.

### L1b — CSP `img-src` blocks GTM beacon images (`www.googletagmanager.com/a?…`) — **fixed (pending hosting deploy)**
- **Where:** every page; 5 console errors on load (surfaced by the e2e smoke spec's raw console
  capture — the harness `walk.ts` noise filter already ignores it).
- **Evidence:** GTM fires an `img` beacon to `https://www.googletagmanager.com/a?id=G-…` but
  `img-src` whitelisted `www.googletagmanager.com` only for `script-src`/`connect-src`, not
  `img-src`. Same benign-GA-noise family as L1.
- **Fix:** added `https://www.googletagmanager.com` to `img-src` in `firebase.json`. Takes effect
  on the next hosting deploy.

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
- **Stripe card-pay + service-fee matrix** — could not exercise the `4242…` card flow: client→
  tradesperson **card pay is gated on the tradesperson completing Stripe Connect payout
  onboarding** (a hosted stripe.com KYC flow), which Quinn skipped, so only the **offline**
  "I've paid the tradesperson" path was available. To test card pay + the non-Pro service fee +
  the Pro fee waiver + declined-card, first connect a test payout account (`/payouts`). Flagged as
  a dedicated follow-up. (The offline mark-paid path WAS exercised end-to-end — see run log.)
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
- **Live two-sided flow, interactive (clientqa ↔ Quinn the approved Painter): GREEN through accept
  + sign.** Walked the **guided post-a-job wizard** end-to-end as the client (NL trade detection →
  title/description → Painter intake → photo upload → budget $600–1,500 → Kelowna address →
  review card → post). Cross-side: Quinn saw it on `/jobs/browse`; opened it; **Draft-with-AI
  correctly hit the Pro paywall** (non-Pro); built a real itemized quote ($850 flat + $220
  materials, 13% tax = **$1,209.10**), got the **uninsured "Are you covered?" reminder**, sent it.
  Cross-side: client saw **"Applicants 1"** with Quinn's Red Seal/ID/Cert badges + full quote →
  **Accept quote → "Sign to accept"** (uninsured-risk warning + **required acknowledgment checkbox**
  + **signature canvas**, drew via synthetic pointer events) → job went **In progress** at
  `/jobs/CdKaH074QIjCrtUUnxoL` with the Details✓→Quote✓→Work→Payment→Done tracker and the full
  street address now revealed to the chosen pro. **0 console errors** the whole way (the one console
  entry is the expected paywall 400). Findings: **UX-3, UX-4, UX-5, UX-6** (above) + the AI-400
  note. Lots of strong UX confirmed (privacy masking, contextual budget hint, review-before-post,
  insurance acknowledgment, verification badges, total-on-button, materials "Cost to client").
  **Next:** tradesperson work phase (clock in/out, submit) → client approve → invoice → Stripe pay
  → mutual reviews.
- **FULL flagship lifecycle COMPLETE end-to-end (interactive, both accounts): GREEN.** Continued
  from accept+sign through to live mutual reviews, alternating client ↔ tradesperson at every hop:
  - **Tradesperson work:** uninsured **"Sign waiver & start"** (liability release + required
    checkbox + signature + Foxquilt "get insured" link) → **auto clock-in** (live timer) → Work
    order tab (Charges-so-far $1,070 fixed, Time "no charge" on fixed-price, Change orders,
    Expenses) → **"Add expense" → free receipt OCR ran with NO paywall** for non-Pro Quinn ("Receipt
    read") → saved a $180 expense (correctly not billed on fixed-price) → clock out (2m logged) →
    **"Create invoice" = 4-step Finish-job wizard** (Time → Expenses → Extras → Discount/Note), built
    the invoice from the quote ("Add all"), added a completion note → **"Send for approval —
    $1,209.10"** → job **Awaiting approval**.
  - **Client:** saw "Please review the work" → **Review invoice** (INV-2026-0001, Total due
    $1,209.10) → **Approve & pay** → offline path only (**PAY-1, PAY-2** found here) → marked
    payment sent.
  - **Tradesperson:** **Mark as paid → "Yes, mark paid"** → job **Complete**, invoice **paid** →
    left the client a blind review (categories Punctuality/Communication/Clarity/Payment, comment).
  - **Client:** job **Complete** → left Quinn a blind review (categories Quality/Punctuality/
    Communication/Value) → **"Reviews are live"** (blind-until-both released on mutual submit).
  - **0 console errors** across the whole lifecycle (one benign teardown error on a sign-out). New
    findings: **PAY-1, PAY-2** (payment handshake). Strong UX confirmed: dual insurance
    waivers/acknowledgments, auto clock-in, fixed-price time/expense clarity, **free receipt OCR**,
    finish-job wizard, invoice PDF, fee-free offline-pay note, mutual **blind reviews** with
    role-appropriate categories.
