# Blue Seal — QA Happy Paths

> The step-by-step "golden paths" for the QA team. Each path is the **intended,
> success** route through a feature. Work top-to-bottom; file a bug the moment
> reality diverges from the **Expected** line.
>
> Reference for intended behaviour: the in-app **Help Center** (`/help`). Each
> path cites the relevant article/FAQ slug — open `/help` and search the slug if
> you're unsure how something *should* work.

---

## 0. Setup & reference (read first)

### Environment
- Test against the **deployed test-mode site** (the URL Johnny gives you).
- **Stripe is in TEST MODE** — no real money ever moves. Use the test cards below.
- Test **mobile-first**: do every path at **375px width** first (Chrome DevTools
  device toolbar → iPhone SE / "Responsive" 375), then re-check on desktop.

### Get your accounts (the QA toolkit)
1. Sign up at `/sign-up` — create **one account** (you'll hold multiple roles on it).
2. Ask an admin to grant your account the **QA role** (Admin → Users → your user →
   tick **qa** → Save). One-time.
3. Open **`/qa`** (also in the left side panel as **QA toolkit**, and `/qa` works
   on mobile). From here you self-serve, no admin needed:
   - **Become an approved tradesperson** — pick trade(s) → *Provision me*. You're
     instantly approved + visible (no vetting wait) on those trades.
   - **Blue Seal Pro** — *Enable Pro* / *Disable Pro* to test free vs Pro.
   - **Reset my data** — wipes your jobs/posts/applications + sets your tradie
     profile back to draft, so you can re-run a flow clean.
   - **Switch views** — use the role switcher (side panel / Account) to move
     between **Client** and **Tradesperson** views. (QA is a capability, not a
     view — there's no "QA view".)

### Stripe test cards (CAD · any future expiry · any CVC · any postal code)
| Card number | Result |
| --- | --- |
| `4242 4242 4242 4242` | Payment succeeds |
| `4000 0000 0000 0002` | Card declined |
| `4000 0000 0000 9995` | Declined — insufficient funds |
| `4000 0027 6000 3184` | 3-D Secure challenge (complete it) |

### Logging bugs
- Use the floating **Report a bug** button (bottom-right, visible to QA on every
  screen). It auto-captures the page + your active role.
- **Screenshots: paste them** — copy a screenshot (e.g. Win **⊞+Shift+S**, Mac
  **⌘+Shift+4**) then **Ctrl/⌘+V** inside the bug dialog. Pasted images are
  converted to WebP automatically. (A *Choose file* fallback exists.)
- Fill **Title, Severity, Steps, Expected, Actual**. Submit → it lands in admin
  triage (`/admin/bug-reports`). You can see your own in `/qa` → *My bug reports*.
- **Crashes/JS errors are captured automatically** in the **Error log** (visible
  to QA at `/qa` → *Error log*, and admins at `/admin/errors`). If you hit a
  white screen or a console error, still file a bug **and** note it's in the
  error log.

### Severity guide
- **Critical** — blocks a core flow / data loss / payment wrong / security.
- **High** — feature broken, no workaround.
- **Medium** — broken with a workaround, or wrong on one screen.
- **Low** — cosmetic / copy / minor mobile glitch.

---

## 1. Onboarding & verification  → help: `get-verified`, `create-an-account`, `insurance-and-getting-covered`

Tradesperson verification has three independent documents — **ID**, **certification(s)**,
**insurance** — that gate different things. Walk all four states.

### 1.1 Client sign-up (the simple one)
1. `/sign-up`, choose **Client**, enter name/email/password, accept terms.
2. **Expected:** lands on the client dashboard; no wizard; can immediately search
   and post jobs. A verification email is sent.

### 1.2 Tradesperson onboarding — NO ID / NO cert / NO insurance
1. `/sign-up`, choose **Tradesperson** → lands in the 7-step onboarding wizard.
2. Fill **Basics** (name + bio), **Trades** (primary trade), **Pricing**, **Area**
   (location), optionally **Hours**. Skip the **Documents** step entirely.
3. Go to **Submit**.
4. **Expected:** **cannot submit for vetting** — the submit step lists the
   blockers (needs **ID** + at least **one certification**). Trying to open
   `/jobs/browse` shows a "not eligible / finish onboarding" message — you are
   **not visible** to clients.

### 1.3 Tradesperson onboarding — ID ONLY
1. From 1.2, in **Documents** upload a government **ID** only (any test image).
2. Try **Submit**.
3. **Expected:** still **cannot submit** — certification is still required. The
   blocker now names only the missing cert (ID is satisfied).

### 1.4 Tradesperson onboarding — CERT + ID, NO insurance
1. Add **one certification per trade** (upload an image, or declare "no formal
   certification" where allowed) **and** the **ID**. Leave **insurance** empty.
2. **Submit for vetting.**
3. **Expected:** submits successfully → status **Pending review**; the form goes
   read-only with a "Withdraw to edit" option.
4. As **admin** (or have the admin tester) approve the ID + cert in the vetting
   queue. *(QA shortcut: provisioning via `/qa` approves you instantly — use that
   when you only need an approved tradie, not to test the vetting gate itself.)*
5. **Expected after approval:** you become **visible/eligible** — you appear in
   client search and can browse the job board. **No "Insured" badge** (insurance
   is optional). Insurance-related disclosures appear later (see 4.2 / path uses
   the uninsured waiver).

### 1.5 Tradesperson onboarding — ALL docs incl. insurance
1. As 1.4, plus upload **insurance**. Test **both** branches:
   - **Blue Seal additional-insured** declared, and
   - **own-policy** path → you sign the **liability release**.
2. Optionally add **WSIB/WorkSafe** for your province.
3. **Expected:** after admin confirms insurance, the **Insured** badge shows on
   your public profile.

### 1.6 Google sign-up — client AND tradesperson (no spurious error)
1. `/sign-up`, choose **Client**, accept terms, click **Continue with Google**,
   pick a Google account.
2. **Expected:** **no error toast/message** (regression guard — this used to flash
   "You don't have permission to do that." while still creating the account). Lands
   straight on the **client dashboard**, signed in, email already verified.
3. Repeat with **Tradesperson** selected before clicking Continue with Google.
4. **Expected:** no error; lands in the **onboarding wizard** with the
   **tradesperson** role already granted (resume works on return — see 1.2).
5. From `/sign-in` (not sign-up), a **brand-new** Google account → you're redirected
   to the **`/welcome`** step ("How will you use Blue Seal?"). It **cannot be
   skipped** (no silent client default). Choose *tradesperson* → `/onboarding`;
   choose *client* → dashboard. A **returning** Google account skips `/welcome` and
   lands on the dashboard (or its redirect target).
6. **Mobile (375px):** popup + `/welcome` cards usable; no horizontal scroll.

### 1.7 Google One Tap — "Continue as <name>" (only when configured)
> One Tap is **OFF until `VITE_GOOGLE_OAUTH_CLIENT_ID` is set** (see HUMANTASKS).
> With it unset, skip this path — the button flow (1.6) is the coverage.
1. Logged out, open `/sign-in` (or `/sign-up`). **Expected:** the **"Continue as
   <name>"** One Tap card appears (top-right on desktop).
2. Tap it. **Expected:** signs in with no password. A **brand-new** account lands on
   **`/welcome`** (forced role choice, as 1.6 step 5); a **returning** account lands
   on the dashboard.
3. **Regression:** the plain **Continue with Google** button still works whether or
   not One Tap shows, and One Tap **never** appears once you're already signed in.

---

## 2. Job creation  → help: `post-a-job`, `request-a-quote`, `find-a-tradesperson`, `bring-your-own-client`

### 2.1 Client posts a job to the board (open marketplace)
1. As **Client**, `/jobs/post`. Wizard: **trade → describe → trade-specific
   details → photos (≥1) → when & where (address) → review**.
2. Confirm the **draft persists** (reload mid-wizard → fields restored) and the
   **rebate panel** shows on review for energy-type work.
3. Submit.
4. **Expected:** post created; visible to matching tradespeople in `/jobs/browse`;
   you can see it under your posted jobs.

### 2.2 Client requests a quote from a specific tradesperson (direct)
1. As **Client**, `/search` → open a tradesperson profile → **Request a quote**.
2. Same wizard shape (trade only shown if they offer 2+).
3. Submit.
4. **Expected:** a job is created in **Requested** status; the tradesperson is
   notified (in-app + email); a job chat opens.

### 2.3 Tradesperson creates a job for their own client (invite / solo)
1. As **Tradesperson**, `/jobs/new`. Enter client name + email, trade, address.
2. Submit.
3. **Expected:** returns a copyable **invite link** + emails a magic sign-in link
   to the client. Job appears in your kanban (client not yet attached). This flow
   is **free** (no Pro needed).

---

## 3. Applications & quotes (tradesperson)  → help: `win-work`

Provision yourself on the post's trade first (`/qa`) so the post is in your feed.

### 3.1 Apply with a full itemized quote (default)
1. As **Tradesperson**, `/jobs/browse` → open a post → **Apply**.
2. Build an itemized quote: line items, optional **upfront fee**, **proposed
   start date**, estimated duration, terms, cover note.
3. Submit.
4. **Expected:** application sent with the quote; post drops out of your feed (you
   already applied). The client sees your quote in their compare view.

### 3.2 Apply — "I need a site visit first"
1. On a post, choose **Site visit first**. Set a visit fee (**$0 is allowed**),
   optional date, note. Submit.
2. **Expected:** the client sees "Site visit: $X / Free visit" instead of a price.
   After they accept, the job enters **Requested** and you send a firm quote later.

### 3.3 Apply — "Chat first" / ask for more information
1. On a post, choose **Chat first**, write your questions. Submit (no quote yet).
2. **Expected:** the client sees "Wants to chat" and can open a Q&A thread.
3. After the client answers, **revise your application** to attach a full quote.
4. **Expected:** the client's compare view shows your quote with a "Revised" mark.

### 3.4 Direct-request quote + propose a site visit
1. On a **Requested** direct job (from 2.2), open it and **send a quote**
   (itemized). Optionally try **Draft with AI** — see 8.2 for the Pro gate.
2. Alternatively **propose a site visit** on the direct job.
3. **Expected:** job moves to **Quoted**; the client is notified.

---

## 4. Client reviews & accepts  → help: `post-a-job`, `the-job-thread`

### 4.1 Compare applications & accept a quote
1. As **Client**, open your posted job → review applications. Expand quote
   breakdowns; open an applicant **chat**; **decline** one (optional reason).
2. **Accept** an applicant's quote → **sign** on the signature pad.
3. **Expected:** post closes; a job is created in **In progress** (or **Awaiting
   upfront payment** if the quote had an upfront fee); a job chat opens; **other
   applicants are notified** they weren't selected. You never see the total
   applicant count (bid-blind).

### 4.2 Accept an uninsured tradesperson (waiver)
1. Use a tradesperson with **no insurance** (1.4 state). As the client, accept
   their quote.
2. **Expected:** before signing you must tick the **uninsured acknowledgement**;
   the signature also records the waiver.

### 4.3 Direct quote — accept / decline / revise
1. On a **Quoted** direct job, as the client **Accept** (sign), **Decline** (with
   reason), or have the tradie **revise & resend**.
2. **Expected:** accept → **In progress**; decline → stays **Quoted**, tradie can
   revise.

---

## 5. Job pipeline (the kanban)  → help: `work-order-time-and-change-orders`

1. On an **In progress** job, as the **Tradesperson**: **clock in / clock out**,
   add **travel** and **expenses**, and **scan a receipt** (receipt OCR).
2. **Expected:** receipt OCR reads vendor/total **for free** — **no paywall** (it's
   the one free AI feature).
3. **Change order:** propose extra work (flat or hourly). As the **client**,
   approve or decline it.
4. **Expected:** approved extras fold into the final invoice.
5. **Wrap up:** tradie submits the job → status **Awaiting client approval**.
   Client **Approves** (→ Awaiting payment) or **Requests changes** (tradie
   re-submits).

---

## 6. Payments (Stripe test mode)  → help: `quotes-and-invoices`, `paying-for-a-job`, `getting-paid-out`

### 6.1 Pay an upfront fee
1. Accept a quote that has an **upfront fee** (3.1). As the client, pay it with
   `4242 4242 4242 4242`.
2. **Expected:** fee marked paid; job moves from **Awaiting upfront payment** to
   **In progress**.

### 6.2 Invoice → card payment → service fee
1. As the **Tradesperson**, send the invoice. As the **Client**, pay by **card**.
2. **Expected:** a **Blue Seal service fee** is shown at checkout (**5%, min $2,
   capped $99**) before you confirm; `4242…` succeeds; job → **Complete**.
3. Try `4000 0000 0000 0002` → **Expected:** decline surfaced, job stays unpaid.

### 6.3 Pro fee waiver
1. Make the tradesperson **Pro** (`/qa` → Enable Pro). As the client, pay their
   invoice by card.
2. **Expected:** the service fee is **waived to $0**.

### 6.4 Offline payment (no fee)
1. Mark an invoice paid by **e-transfer / cash** instead of card.
2. **Expected:** **no service fee**; job completes.

---

## 7. Reviews  → help: `mutual-reviews`

1. On a **Complete** job: as the **Client**, leave a public review (overall +
   quality/punctuality/communication/value). As the **Tradesperson**, leave a
   **private** review of the client.
2. **Expected:** reviews are **blind until both** are submitted; the public review
   shows on the tradie's profile and updates their rating. **Solo/invite jobs
   never produce public reviews.**

---

## 8. Blue Seal Pro & the paywall  → help: `blue-seal-pro`, `clients-and-recurring-billing`

### 8.1 Start a real trial (Stripe path)
1. As a tradesperson **without** Pro, start the trial via the upgrade flow →
   Stripe Checkout (card required, `4242…`).
2. **Expected:** status becomes **Trialing** (30 days); the billing portal lets
   you cancel/switch. *(For most QA, just toggle Pro instantly in `/qa` instead.)*

### 8.2 Paywall on AI tools
1. As a **non-Pro** tradesperson, try an **AI** tool (AI assistant, **Draft with
   AI** on a quote/invoice, suggested replies).
2. **Expected:** the **Blue Seal Pro paywall** popup appears. Enable Pro (`/qa`)
   → the same action now works. **Receipt OCR stays free** (re-confirm 5.2).

### 8.3 Clients tab + recurring billing (Pro)
1. As a **Pro** tradesperson, open **Clients**, create a **recurring plan**.
2. **Expected:** it **drafts** an invoice each period and **never auto-sends or
   auto-charges**; you can pause/resume. (Whole Clients tab is Pro-gated.)

---

## 9. Cross-cutting

1. **Role switching** — flip Client ⇄ Tradesperson (side panel / Account); the
   view changes. → `switching-roles`
2. **Account & profile** — edit profile, notification prefs. → `notifications`
3. **Email notifications** — key events (new request, quote, message, invoice)
   send a branded email.
4. **PWA install** — install to home screen (iPhone/Android/desktop). → `install-the-app`
5. **Help Center** — browse `/help`, search, open an article and a FAQ. →
   `report-a-problem`

---

## 10. The QA toolkit itself  → (no help article; internal)

1. **Provision** yourself as a tradesperson on a given trade (`/qa`) → confirm you
   appear in client **search** and can **browse jobs**.
2. **Toggle Pro** on → AI unlocks + client fee waived; off → paywall returns.
3. **Reset my data** → your jobs/posts/applications are gone, profile back to
   draft; re-provision and re-run.
4. **File a bug** via the floating button (paste a screenshot) → confirm it
   appears in **My bug reports** (`/qa`) and in **admin triage** (`/admin/bug-reports`).
5. **Error log** — trigger nothing special; just confirm `/qa` → *Error log* lists
   recent captured errors and you can mark one **Resolved**.
6. **Browse-area override (job board).** Provision yourself as a tradesperson,
   then open **Browse open jobs**. Use the QA-only **"QA: browse area"** dropdown
   (only the qa role sees it) to pick a preset city (e.g. Toronto).
   **Expected:** the feed re-centres on that city **without** changing your saved
   service area; the radius slider goes up to **5000 km for QA** (500 km for a
   normal tradesperson). "My saved area" returns to your own location, and the
   pick **sticks across navigation** (reload the page → still set). This lets you
   test postings in any region without editing your profile.

---

## 11. Sales reps  → (rep-internal; no public help article)

> Requires an admin to grant your account the **sales** role (Admin → Users →
> your user → tick **sales** → Save). The sales tools live under **/sales** (use
> the role switcher → **Sales**).

1. **First-login liability gate.** After being granted the sales role, switch to
   **Sales** view. **Expected:** a blocking **Sales representative agreement**
   dialog appears and cannot be dismissed. Draw a signature → **Agree & sign**.
   **Expected:** the dialog closes and you land on **/sales**.
2. **Gate persists until signed.** Before signing, reload the page in Sales view.
   **Expected:** the agreement dialog is still there (you stay inert until signed).
3. **Claim a referral code.** On **/sales**, choose a vanity code (e.g. `JOHNNYK`,
   3-20 letters/numbers) → **Save**. **Expected:** the code saves and a shareable
   referral link (`/join?ref=JOHNNYK`) appears with a copy button. Try a taken or
   too-short code → **Expected:** a clear error, no save.
4. **Mobile (375px).** Re-run steps 1 + 3 at 375px. **Expected:** the agreement
   dialog scrolls, the signature pad draws with touch, and the code form is usable.
5. **Referral signup (the link).** Copy your `/sales` referral link
   (`/join?ref=CODE`) and open it in a private window. **Expected:** it lands on
   tradesperson signup with the code pre-filled and a green "first month free"
   banner. Complete signup, then take that tradesperson through vetting to
   **live** (cert + ID approved). **Expected:** on go-live they are Pro for one
   month with NO card on file (Pro badge shows / the client service fee is
   waived on their jobs).
6. **Direct signup unchanged.** Sign up as a tradesperson WITHOUT a code.
   **Expected:** no free-month banner, and the normal 30-day card trial path
   applies (no auto-comp).
7. **Rep reviews + approves an owned application.** As a signed-in rep (with a
   region or a referral), open **/sales → Applications to review**.
   **Expected:** you see the pending tradespeople in your region, or who used
   your code. Open one → **Expected:** their certifications + ID render with
   "View document" links that open the file. Tap **Approve** → **Expected:** the
   tradesperson goes live and the application leaves your queue.
8. **Rep can't touch others' applications.** A pending tradesperson in a
   DIFFERENT region (and not your referral) does NOT appear in your list, and the
   server denies a decision call on them. Admin still sees + vets everyone from
   **/admin/vetting**.
9. **Commission accrues on a referred tradie's revenue (money seam).** This is
   server-side: commissions are written by the Stripe webhook and there is no
   the rep now sees their running balance at **/sales/payouts** (path 11.11), but
   to confirm the exact ledger entry verify in the **Firebase console**
   `commissions` collection. Take a tradesperson who
   signed up via your code (step 5) to **live**, then run them to a **card-paid
   invoice** (6.2) while they are **not** Pro (so the platform service fee
   applies). **Expected:** one `commissions` doc with id `service_fee_<invoiceId>`,
   `repId` = the owning rep, `ownerKind` "referral", `source` "service_fee",
   `status` "accrued", and `commissionCents` = **10%** of the fee's platform
   portion. Exactly one doc, and a webhook retry never adds a second. Then make
   them **Pro** and pay another card invoice. **Expected:** the fee is waived to
   $0, so **no** new commission is written (nothing for the platform to share). A
   real **Pro subscription** payment (8.1) writes a `subscription_<stripeInvoiceId>`
   doc at 10% of the amount charged; the referral **free comp month** writes
   nothing (there is no Stripe charge behind it).
10. **Commission reverses on a refund / lost chargeback (money seam).** From step
    9, **fully refund** the card-paid invoice (admin / Stripe test mode).
    **Expected:** a second doc with id `service_fee_<invoiceId>_reversal`,
    `status` "reversed", `reversalOf` the original id, mirroring the original
    amount; the original accrual is left untouched (the ledger is append-only and
    payouts net accrued minus reversed). A refund retry never adds a second
    reversal. **Negative checks:** a **partial** refund writes **no** reversal (not
    clawed back yet), and a dispute that closes **won** (or without loss) leaves
    the commission intact. Only a **lost** chargeback reverses it.
11. **Rep dashboard + payout onboarding.** As a signed-in rep, open **/sales**.
    **Expected:** an "Earnings & payouts" card shows your **unpaid balance** and
    **paid to date**, plus cards for Applications and your referral code. Open it
    (or the **Earnings** nav item) to reach **/sales/payouts**. **Expected:** the
    unpaid balance matches your accrued commission (net of any reversals), and a
    Stripe Connect onboarding panel invites you to connect a bank. Click **Start
    Stripe setup** → you land on Stripe's hosted form (test mode). Complete it →
    you return to /sales/payouts and, once Stripe confirms, the panel flips to
    **Payouts are live**. Mobile (375px): cards stack, no horizontal scroll.
12. **Rep resources hub.** From /sales, open **Resources** (nav) or visit
    **/sales/resources**. **Expected:** a collapsible playbook (how the program
    works, signing people up, vetting, getting paid, pitching, FAQ). Each section
    expands/collapses; content renders as formatted text. Mobile-friendly.
13. **Admin reps console + payout reconciliation.** As **admin**, open
    **Admin → Sales reps** (`/admin/sales-reps`). **Expected:** every rep is
    listed with their code, regions, payout status, and earnings (unpaid + paid),
    plus an **Activate/Deactivate** toggle. Deactivate a rep → their referred
    tradespeople fall back to the region rep for new commission (re-run 11.9 to
    confirm `ownerKind` becomes "region"). If a payout batch is ever **pending**,
    a **Retry transfer** button appears; clicking it reconciles the transfer
    (safe to click twice — it never double-pays). Assigning a rep to a territory
    still happens in **Admin → Regions**.
14. **Tradesperson sees their rep contact.** As a tradesperson who signed up via
    a rep's code (or whose area has a rep), open **Account → Payouts**.
    **Expected:** a **"Your Blue Seal rep"** card shows the rep's name and a
    contact email link. A tradesperson with **no** rep (direct, unregioned
    signup) sees **no** such card.

---

## 12. Admin — all jobs & postings  → (admin-internal; no public help article)

> Requires the **admin** role. Open **Admin → Manage → Jobs & postings**
> (`/admin/jobs`). This is the system-wide view of every job and every job-board
> posting across **all** regions — admin-only (a sales rep does **not** get it).

1. **See everything.** Seed a couple of jobs + postings in different provinces
   (use two QA accounts, or existing data). Open `/admin/jobs`.
   **Expected:** the **Active jobs** tab lists pipeline jobs newest-first across
   every client/tradesperson; toggle to **Posted jobs** to list job-board
   postings (every status: open/closed/cancelled/expired/hidden).
2. **Filter to one province.** Pick a province in the **Province** filter.
   **Expected:** only jobs/postings whose address is in that province remain;
   clearing it ("x") restores all.
3. **Filter to a sales territory.** Pick a **Sales territory** (these come from
   Admin → Regions; the dropdown is empty/disabled if no regions exist).
   **Expected:** only jobs/postings whose postal code falls in that territory's
   FSA prefixes remain. A job whose postal matches a more specific territory is
   attributed to that one (longest-prefix wins), not a broader overlapping one.
4. **Status + search.** Choose a **Status** (options change with the tab) and
   type in **Search** (title / trade / client / tradesperson / city).
   **Expected:** filters combine (AND); the count line updates; switching tabs
   resets the status filter but keeps province/territory/search.
5. **Open a record.** Click a job → opens its **job detail**; click a posting →
   opens the **job post detail**. **Expected:** admin can open any record even
   though they're not a party.
6. **Cap honesty + mobile (375px).** If more than 300 of a surface exist, the
   count line says so ("most recent 300"). Re-run the filters at 375px.
   **Expected:** the filter controls stack and stay usable; cards read cleanly.

---

## Coverage checklist (tick as you complete a full pass)

- [ ] 1.1 Client sign-up
- [ ] 1.2 Tradie onboarding — no docs (submit blocked)
- [ ] 1.3 Tradie onboarding — ID only (still blocked)
- [ ] 1.4 Tradie onboarding — cert+ID, no insurance (approved + visible)
- [ ] 1.5 Tradie onboarding — all docs incl. insurance (Insured badge)
- [ ] 2.1 Client posts a job to the board
- [ ] 2.2 Client direct-requests a quote
- [ ] 2.3 Tradie creates an invite/solo job
- [ ] 3.1 Apply with full itemized quote
- [ ] 3.2 Apply — site visit first
- [ ] 3.3 Apply — chat first → revise with quote
- [ ] 3.4 Direct-request quote (+ AI draft / site visit)
- [ ] 4.1 Client compares + accepts a quote (sign)
- [ ] 4.2 Accept uninsured tradie (waiver)
- [ ] 4.3 Direct quote accept/decline/revise
- [ ] 5 Pipeline: clock, expenses, receipt OCR (free), change order, wrap-up/approval
- [ ] 6.1 Upfront fee payment
- [ ] 6.2 Invoice card payment + service fee (+ decline)
- [ ] 6.3 Pro fee waiver
- [ ] 6.4 Offline payment (no fee)
- [ ] 7 Mutual reviews
- [ ] 8.1 Pro trial (Stripe)
- [ ] 8.2 AI paywall + receipt OCR free
- [ ] 8.3 Recurring billing drafts (never auto-sends)
- [ ] 9 Role switch / notifications / PWA install / Help Center
- [ ] 10 QA toolkit: provision / Pro toggle / reset / bug / error log / browse-area override
- [ ] 11.1 Sales rep first-login agreement gate (blocks until signed)
- [ ] 11.2 Sales rep claims a vanity referral code (+ link)
- [ ] 11.3 Referral signup via /join?ref= (banner + free month at go-live)
- [ ] 11.4 Direct signup unchanged (no comp, card trial)
- [ ] 11.5 Rep reviews + approves an owned application (docs visible, goes live)
- [ ] 11.6 Rep can't see/act on applications outside their territory
- [ ] 11.7 Commission accrues 10% on a referred tradie (card service fee + Pro sub; none on waived fee / comp month)
- [ ] 11.8 Commission reverses on full refund / lost chargeback (not on partial / won)
- [ ] 11.11 Rep dashboard earnings + Stripe Connect payout onboarding (/sales/payouts)
- [ ] 11.12 Rep resources hub (/sales/resources)
- [ ] 11.13 Admin reps console: roster, activate/deactivate, retry pending payout (/admin/sales-reps)
- [ ] 11.14 Tradesperson sees their Blue Seal rep contact (Account → Payouts)
- [ ] 12 Admin jobs & postings browse (province + territory + status + search, all regions)
