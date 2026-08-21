# Blue Seal — QA Happy Paths

> The step-by-step "golden paths" for the QA team. Each path is the **intended,
> success** route through a feature. Work top-to-bottom; file a bug the moment
> reality diverges from the **Expected** line.
>
> Reference for intended behaviour: the in-app **Help Center** (`/help`). Each
> path cites the relevant article/FAQ slug — open `/help` and search the slug if
> you're unsure how something _should_ work.

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
   - **Become an approved tradesperson** — pick trade(s) → _Provision me_. You're
     instantly approved + visible (no vetting wait) on those trades.
   - **Blue Seal Pro** — _Enable Pro_ / _Disable Pro_ to test free vs Pro.
   - **Reset my data** — wipes your jobs/posts/applications + sets your tradie
     profile back to draft, so you can re-run a flow clean.
   - **Switch views** — use the role switcher (side panel / Account) to move
     between **Client** and **Tradesperson** views. (QA is a capability, not a
     view — there's no "QA view".)

### Stripe test cards (CAD · any future expiry · any CVC · any postal code)

| Card number           | Result                             |
| --------------------- | ---------------------------------- |
| `4242 4242 4242 4242` | Payment succeeds                   |
| `4000 0000 0000 0002` | Card declined                      |
| `4000 0000 0000 9995` | Declined — insufficient funds      |
| `4000 0027 6000 3184` | 3-D Secure challenge (complete it) |

### Logging bugs

- Use the floating **Report a bug** button (bottom-right, visible to QA on every
  screen). It auto-captures the page + your active role.
- **A screenshot of the page is attached automatically** when you open the
  dialog (a silent client-side render of what's on screen; the button itself is
  excluded). Delete it if it's not useful, or add a clearer one below.
- **Want a sharper/other shot? paste it** — copy a screenshot (e.g. Win
  **⊞+Shift+S**, Mac **⌘+Shift+4**) then **Ctrl/⌘+V** inside the bug dialog.
  All images are converted to WebP automatically. (A _Choose file_ fallback
  exists.) Note: a few surfaces (maps, chart canvases, cross-origin images) can
  render blank in the auto-shot, so paste a real capture for those.
- Fill **Title, Severity, Steps, Expected, Actual**. Submit → it lands in admin
  triage (`/admin/bug-reports`). You can see your own in `/qa` → _My bug reports_.
- **Crashes/JS errors are captured automatically** in the **Error log** (visible
  to QA at `/qa` → _Error log_, and admins at `/admin/errors`). If you hit a
  white screen or a console error, still file a bug **and** note it's in the
  error log.

### Severity guide

- **Critical** — blocks a core flow / data loss / payment wrong / security.
- **High** — feature broken, no workaround.
- **Medium** — broken with a workaround, or wrong on one screen.
- **Low** — cosmetic / copy / minor mobile glitch.

---

## 1. Onboarding & verification → help: `get-verified`, `create-an-account`, `insurance-and-getting-covered`

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
   queue. _(QA shortcut: provisioning via `/qa` approves you instantly — use that
   when you only need an approved tradie, not to test the vetting gate itself.)_
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
   skipped** (no silent client default). Choose _tradesperson_ → `/onboarding`;
   choose _client_ → dashboard. A **returning** Google account skips `/welcome` and
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

## 2. Job creation → help: `post-a-job`, `request-a-quote`, `find-a-tradesperson`, `bring-your-own-client`

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

1. As **Tradesperson**, `/jobs/new`. Enter client name, trade, address. **Email
   and phone are both optional** — only the name is required.
2. **Trade field:** if your profile has a single trade, it shows as a read-only
   line (no dropdown to change). With two-plus trades it's a dropdown defaulted
   to your primary trade, changeable.
3. **Photos (optional):** tap **Add photo** and attach 1-8 images. They compress
   client-side, preview as thumbnails, and each can be removed with the ×.
4. **Quoting (optional):** leave **"Quote already agreed — skip straight to the
   work"** OFF for the standard flow. Submit.
5. **Expected:** returns a copyable **invite link** + emails a magic sign-in link
   to the client. Job appears in your kanban at **New job** (client not yet
   attached), and any photos you attached show as the job's intake photos. This
   flow is **free** (no Pro needed). Mobile (375px): the photo grid is 3-up and the
   form is single-column.
   5a. **Skip the quote (price already agreed).** Create another job with **"Quote
   already agreed — skip straight to the work"** turned ON. **Expected:** the job
   opens directly at **In progress** with no quote step (server stamps fixed
   billing + 0% job-line tax; no `quotes/{jobId}` doc). You invoice from logged
   time + materials, exactly like a solo job — there's nothing to quote or accept.
   5b. **One-tap invite link → the job.** Copy the invite link and open it
   signed-out (incognito) as the client, then tap **View my job**. **Expected:**
   for a **brand-new** client email, one tap signs them straight in (no email
   typing, no inbox detour) and lands them on `/jobs/:id` with the job claimed
   (`clientId` attaches; the copy link then dies). For an email that **already has
   a Blue Seal account**, it instead shows **"Check your inbox"** and emails that
   inbox a one-tap magic link — the account-takeover guard, so only the inbox
   owner can get in. A revoked/expired/used link shows a uniform "invalid,
   expired, or already used" error. (Server: `redeemJobInvite`.)
6. **Send a quote / invoice before the client has joined.** Without claiming the
   invite, send the client a quote (and later an invoice) on that job.
7. **Expected:** the client (whose `clientInvite.emailLower` is still unclaimed)
   gets a **branded email with the full breakdown and a one-tap magic-link CTA**
   ("Review & approve" for the quote, "View & pay" for the invoice). Clicking it
   signs them in, claims the job (`clientId` backfills on job/quote/invoice), and
   lands them on it. The email is gated exactly like the initial invite
   (suppression list / CASL address / email-link enabled) and respects the
   invite unsubscribe. If it can't send, the tradesperson can still record
   acceptance / mark paid offline.
8. **No client email at all (phone booking).** Create a job with the **email left
   blank** (add a phone number instead). **Expected:** it saves — no "enter a
   valid email address" block. The success dialog says you're running it solo and
   shows **no invite link** (there's no invite to mint). On the job page the
   banner reads **Solo job / no client email on file** with an **Invite client**
   button; the job's Brief tab shows **Client contact** with the phone as a
   tap-to-call link (tradesperson only). Tap **Invite client**, enter an email →
   the first invite is minted and emailed, and the banner flips to **Waiting for
   … to join**. (Server: `createInviteJob` with no email writes
   `clientInvite: null`; `resendJobInvite` with `newEmail` mints it.)
9. **Fill in the trade-specific brief as the tradesperson.** On a job you created,
   open the **Brief** tab. **Expected:** the trade-specific fields are **editable**
   (not greyed out) with a **Save details** button. Save → the answers persist and
   the job's **status does not change** (it stays where it was; only the client's
   "Submit brief" advances a job). On a marketplace job (`sourcePostId` set) and on
   a closed job (complete / reviewed / cancelled) the fields stay read-only.

---

## 3. Applications & quotes (tradesperson) → help: `win-work`

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

### 3.5 Pick how to quote (time & materials vs itemized vs site visit)

1. On a **Requested** direct job, open the **Quote** tab. **Expected:** before any
   form, three cards: **Time & materials**, **Itemized quote**, **Site visit
   first**. No action row yet (nothing to send).
2. Choose **Time & materials**. **Expected:** the form opens pre-seeded with an
   **Hourly** line at your profile rate and a **Materials** line at $0 — set the
   hours, price or delete the materials line, and send. The optional money
   sections (discount, upfront fee, validity, terms) are **hidden**; a **Show
   every option** link reveals them.
3. Tap **← Change how you're quoting** → choose **Itemized quote**. **Expected:**
   back to the four-step guided wizard, and **the lines you already typed are
   still there** (nothing is reset by switching).
4. On wizard step 1, tap **Back**. **Expected:** returns to the three cards
   rather than dead-ending on a disabled button.
5. **Scope of work section order.** In the composer, the three \*\*+ Hourly /
   - Flat rate / + Materials** buttons sit **above** an **"On this quote (N)"\*\*
     block that holds the rows. Tapping one adds a row into that block below and
     focuses its description — the row must not appear above the add buttons.
6. **Resend/revise an existing quote.** Open the **Quote** tab on an
   already-quoted job. **Expected:** no chooser — straight to the full form with
   every section, hydrated from the sent quote. Send it: you stay on the tab and
   it reloads into the revise state (no dialog to dismiss).
7. Mobile (375px): each card is a full-width tap target at least 64px tall, and
   the **Send quote** action row stays pinned to the bottom of the viewport in a
   long itemized form.

### 3.6 Quoting is optional, not a gate → issues #19 + #22

1. As **Tradesperson** on a **Requested** direct job, look at the job page before
   touching anything. **Expected:** **no** full-width sticky "Prepare quote" bar
   at the bottom, and **no** "Quote needed" chip in the top-right. The only
   quote affordance is the **Quote** tab, carrying a red badge dot.
2. **Tab list.** Brief · Schedule · **Quote** · Work order · Invoice, in that
   order. As a **client** on the same job there is **no Quote tab** (the client
   sees the quote itself on the Invoice tab).
3. **The tab explains itself.** Open **Quote**. **Expected:** header reads
   "Prepare a quote" with "Optional. You can send an invoice without ever
   quoting."
4. **The skip path is findable.** At the bottom of the Quote tab, tap **Skip the
   quote — invoice directly**. **Expected:** you land on the **Invoice** tab,
   where **New invoice** mints a blank invoice with no quote and no tracked time.
   Send it → job moves to **Awaiting payment** → mark paid → job closes out.
   This is the whole point of #19: the backend has allowed it since PR #15 and
   nothing pointed at it.
5. **Status is still readable.** On every status other than Requested, the
   top-right status chip is still there for the tradesperson (only the "Quote
   needed" case is hidden). The client's chip is unchanged on all statuses.
6. **Money CTAs survive.** The sticky bottom bar must still appear for
   **Awaiting upfront payment** ("Mark upfront received") and **Awaiting
   payment** ("Mark as paid") — only the two quote CTAs were removed.
7. **Revise from the Invoice tab.** On a quoted job, the Invoice tab's
   **revise quote** action now switches to the **Quote** tab rather than opening
   a modal.
8. **Site-visit hint moved.** On a Requested job with an **agreed** site visit,
   the "the fee will be pre-filled into your quote" line appears **inside the
   Quote tab**, not on a sticky bar.
9. Mobile (375px): five tabs fit the bar icon-only with no horizontal scroll.

---

## 4. Client reviews & accepts → help: `post-a-job`, `the-job-thread`

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

## 5. Job pipeline (the kanban) → help: `work-order-time-and-change-orders`

1. On an **In progress** job, as the **Tradesperson**: **clock in / clock out**,
   add **travel** and **expenses**, and **scan a receipt** (receipt OCR).
   The header **Clock in** control is the single clock-in surface. When there's
   more than one thing to clock (e.g. an hourly job has **Labour** + **Travel**,
   or an approved hourly change order exists), the button **opens a menu** that
   lists **every** option with its **rate ($/hr)** — there's no silent default,
   so travel / change orders can't be missed. When there's only one option
   (fixed-price job, no approved hourly extras) it's a plain **Clock in** button
   with the rate beside it (labour reads **Time only**). The Work Order **Time**
   card no longer has its own clock-in row (it shows the running session +
   **Add time manually**).
2. **Expected:** receipt OCR reads vendor/total **for free** — **no paywall** (it's
   the one free AI feature).
3. **Uninsured gate:** with a tradesperson who has **no insurance on file**, the
   header clock button reads **Sign waiver** and opens the waiver dialog. Signing
   it (**Sign waiver**) records the waiver and closes the dialog but **does NOT
   start the timer**. The button then becomes **Clock in**, which you must tap
   yourself to begin. Verify the clock only starts on that second, deliberate tap.
4. **Change order:** propose extra work (flat or hourly). As the **client**,
   approve or decline it. Once an **hourly** change order is **approved**, the
   tradesperson sees a **Clock in** button directly on that change order (in the
   Work Order → Change orders card) as well as in the header dropdown; both clock
   time against it at the order's rate. The per-order button hides while a session
   is already running on the job (stop it first).
5. **Expected:** approved extras fold into the final invoice.
6. **Wrap up:** tradie submits the job → status **Awaiting client approval**.
   Client **Approves** (→ Awaiting payment) or **Requests changes** (tradie
   re-submits).

### 5.1 Dashboard calendar — month default + day detail

1. As **Tradesperson**, `/dashboard/tradie?view=calendar`. **Expected:** it opens
   on **Month** (not Week); the Month/Week toggle is top-right with Month first.
2. Month cells show up to two job chips **prefixed with the start time in
   12-hour am/pm** (e.g. `9 a.m. · Boiler service`), then `+N more`. A blocked day is tinted red
   with a ban icon; a working day shows a small blue dot.
3. **Tap any day cell.** **Expected:** a **day sheet** opens titled with the full
   date, showing the day's **working hours** (`8:00 a.m.–5:00 p.m.`), then an
   **hour rail** labelled in 12-hour am/pm (`7 a.m.`, `12 p.m.`, `1 p.m.`) with
   each scheduled job drawn against the hours it occupies (title,
   `9:00 a.m. – 11:30 a.m.`, client). Tapping a job block closes the sheet and
   opens that job. An empty day reads **Nothing scheduled**.
4. **Blocking moved into the sheet.** A bare tap on a month cell must **no longer
   block the day**. Instead the sheet's footer has **Block day** (future,
   unblocked days only) → confirm dialog → the day tints red. Re-open a blocked
   day → the sheet shows a red **You've blocked this day** bar with **Unblock**.
5. **Multi-day jobs.** A job with `scheduledStart` Mon and `scheduledEnd` Wed
   appears on **all three** days, not just Monday. The time prefix shows only on
   the first day.
6. **Read-only viewers.** Open a tradesperson's public profile calendar as a
   client / signed-out. **Expected:** days still open the sheet, but there is
   **no Block day / Unblock** control anywhere.
7. **Week view** still works (toggle to it): day headers are tappable and open the
   same sheet; the per-day **Block day** button is unchanged.
8. **12-hour times everywhere (issue #17).** Sweep the whole calendar — month
   chips, week chips, the day sheet's working-hours line, the hour gutter, every
   job block label — and confirm **no 24-hour time** is left (no `13:30`, no
   `17:00`, no `24:00`). Midnight reads `12:00 a.m.` and noon `12:00 p.m.`.
   Stored data is unchanged: reload and the same times come back.
9. Mobile (375px): the month grid stays 7 columns and the day sheet fits without
   horizontal scroll. Check the hour gutter specifically — `12 p.m.` must fit the
   rail rather than wrap or clip.

### 5.2 Book time against a job from the calendar

1. As **Tradesperson** with at least one live job, open the dashboard
   **Calendar** and tap a day → **Add time to a job**.
2. **Expected:** a dialog with a **job picker** listing every LIVE job (accepted,
   requested, quoted, awaiting upfront payment, in progress, on hold — each row
   showing its status + client) and **Start** / **End** times pre-filled from
   that day's working hours **in 12-hour form** (`8:00 a.m.` / `5:00 p.m.`, not
   `08:00` / `17:00`), plus an optional note.
3. Pick a job, set `9:00 am`–`12:00 pm`, add a note, **Add to calendar**.
4. **Expected:** a toast confirms it; the visit appears **on that day at those
   hours** in the day sheet and as a time-prefixed chip in the month cell. Open
   the job → **Schedule tab** → the same visit is listed there. It is a
   **scheduled visit, not billable time**: the work order's time total and the
   invoice are unchanged.
5. **Clash warning.** Add a second visit overlapping an existing booking (or a
   blocked day). **Expected:** it still saves, but the toast warns it overlaps
   and names what it clashes with — a warning, not a block.
6. **Validation + what the fields accept.** Try End before Start → inline "The
   end time has to be after the start."; try a junk time like `99:99` or `noon`
   → "Enter times like 9:00 am (24-hour, e.g. 17:00, works too)."; try saving
   with no job picked → "Pick a job first." Then confirm every shape the field
   takes still books the right hours: `5pm`, `5 PM`, `5:00 p.m.` and the
   old-habit `17:00` must all land the visit at **5:00 p.m.**, and `12 am` /
   `12 pm` must not swap.
7. **One block per visit.** Book two short visits on the SAME job on different
   days. **Expected:** two separate blocks at their own hours — not one bar
   spanning the whole range.
8. **Finished jobs excluded.** A complete / reviewed / cancelled job must NOT
   appear in the picker.
9. **Read-only calendars.** On a tradesperson's public profile and the PM
   calendar (`/manage/calendar`), there is **no Add time to a job** button.
10. **Availability editor.** Profile → working hours. The `99:99` masked fields
    still take a 24-hour `17:00` (that's the stored format), but each row now
    carries a live 12-hour read-back beneath it — `9:00 a.m. – 5:00 p.m.` —
    which updates as you type and stays blank while a value is half-entered.
11. **Job Schedule tab + manual time entry.** Open a job → **Schedule** → add a
    visit, and open the work order's **manual time entry** dialog. **Expected:**
    both time pickers are am/pm (with an AM/PM toggle), not a 0–23 hour spinner.
12. Mobile (375px): the dialog fits, the job picker is usable one-handed, and an
    availability row (two time fields + delete) does **not** overflow sideways.

---

### 5.3 Jobs list — per-job action menu → issue #21

> Tradesperson view only. The client's jobs list keeps the plain status chip.

1. As **Tradesperson**, open `/dashboard/tradie` (Jobs). **Expected:** every job's
   status chip now has a **chevron** and is tappable. The status text is
   unchanged ("New job", "In progress", …) — the ask was to make it
   actionable, not to remove it.
2. **Items follow the status machine.** Tap the chip on each of these and check
   the menu:
   - **Requested / Accepted / Quoted:** Open job · Quote (or **Revise quote** on
     Quoted; no Quote item on Accepted) · Schedule · Invoice · **Cancel job** (red).
   - **In progress:** Open job · Schedule · Invoice · **Complete job**. No Quote,
     no Cancel.
   - **Awaiting upfront / Awaiting approval / Awaiting payment / On hold:**
     Open job · Schedule · Invoice only.
   - **Complete / Reviewed / Cancelled** (View completed): **Open job** only.
3. **Each action lands on the right surface.** Quote → the job's **Quote** tab;
   Schedule → **Schedule** tab; Invoice → **Invoice** tab; Open job → the Brief.
4. **Complete job confirms first.** Tap it on an in-progress job. **Expected:** a
   dialog — "Complete this job? You'll finalize the invoice on the next screen"
   — with **Cancel** / **Continue**. Continue opens the job with the **wrap-up
   sheet already open** (the same FinishJobSheet as the Invoice tab; there is
   only one implementation). Back out of the sheet, reload the job: the sheet
   must **not** re-open (the `?finish=1` key is stripped after use).
5. **Cancel job takes a reason.** Tap it on a Requested job. **Expected:** a
   dialog warning the client is notified and it can't be undone, with a required
   **reason** field. Submit empty -> toast "Add a reason so your client knows what
   happened." and the dialog stays open. Add a reason -> **Cancel job** -> the job
   moves to **Cancelled**, drops into the completed view, and the **client** gets
   a `job_cancelled` notification carrying your reason.
6. **Cancel is pre-commitment only.** Confirm there is **no** Cancel item on an
   in-progress or awaiting-payment job — past commitment the other party has to
   agree, and there is no tradesperson-side cancel-request loop.
7. **Tapping the chip must not open the job.** The card itself is clickable;
   tapping the status chip opens the menu and nothing else.
8. Mobile (375px): the popup fits inside the viewport (no horizontal scroll), the
   chip is at least a 44px tap target, and no menu label wraps or clips.

---

## 6. Payments (Stripe test mode) → help: `quotes-and-invoices`, `paying-for-a-job`, `getting-paid-out`

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
4. In Stripe, open the PaymentIntent → **Expected:** its statement descriptor
   reads `BLUESEAL* <tradesperson business name>`, clipped to 12 characters of
   suffix. A tradesperson with no usable name falls back to a bare `BLUESEAL`
   rather than failing the charge.

### 6.3 Pro fee waiver

1. Make the tradesperson **Pro**. NB: `/qa` → Enable Pro is **disabled in the
   live project** (`QA_TOOLKIT_ENABLED=false` since the Stripe cutover), so
   grant it from Admin → user search → **Blue Seal Pro (founding comp)**, or
   run a real Pro checkout. As the client, pay their invoice by card.
2. **Expected:** the service fee is **waived to $0**.

### 6.4 Offline payment (no fee)

1. Mark an invoice paid by **e-transfer / cash** instead of card.
2. **Expected:** **no service fee**; job completes.

### 6.5 Payout setup survives a Stripe account change

The live cutover (2026-08-19) moved Blue Seal to a **different** Stripe account,
not just a different mode, so every `acct_` minted during sandbox testing 404s
against the live key. A tradesperson whose saved account id is one of those used
to be stuck: "Start Stripe setup" returned a bare `INTERNAL` on every click.

1. As a tradesperson, open **Account → Payouts** and click **Start Stripe
   setup**. **Expected:** you reach Stripe's hosted onboarding form.
2. Simulate an orphaned id: in Firestore, set
   `tradespeople/{uid}.payouts.stripeAccountId` to a made-up `acct_xxx` (leave
   the rest of the block alone). Reload and click **Start Stripe setup**.
3. **Expected:** you are NOT dead-ended. The server notices the id doesn't
   resolve, discards it, creates a fresh account, and you land on Stripe's form.
   If the error toast does appear it reads a real sentence ("Your payout account
   couldn't be found at Stripe…"), never `INTERNAL`, and a **second** click gets
   through. The Cloud Functions log carries Stripe's own `code` + `requestId`.
4. Repeat for the **project manager** (`/manage` → Earnings) and **sales rep**
   (`/sales/payouts`) panels — same recovery, their payouts blocks were never
   swept at cutover.
5. **Expected (money control):** a freshly created *tradesperson* account records
   `payouts.payoutHoldDays: 7`. If it reads `null`, the 7-day chargeback hold did
   NOT apply — onboarding deliberately continues, but the miss is logged at
   error level and needs fixing in Stripe. PM + rep accounts are undelayed by
   design and always read `null`.
6. Mobile (375px): the Payouts panel and its error toast fit without scroll.

### 6.6 Write an invoice by hand (no quote, no tracked time)

The money-path seam here is **draft privacy**: a hand-written invoice must stay
invisible to the client until it's actually sent, and it must not be wiped by
the wrap-up sheet.

1. As the **Tradesperson**, open a job that has **no quote and no logged hours**
   (a direct request still at **Requested**, or a solo job from 2.3). Go to the
   **Invoice** tab and tap **New invoice**.
2. **Expected:** an invoice appears with the next number in your sequence
   (`INV-<year>-000N`), one $0 starter line named after the job, and it's
   editable straight away. No job status change — the kanban column is unmoved.
3. Add two lines (e.g. `Emergency callout` $125 @ 13%, `Parts` $40 @ 13%), set a
   discount, and **Save**. Re-open the tab. **Expected:** the lines, tax and
   discount all persisted, and the total matches subtotal − discount + tax.
4. **As the Client on the same job**, open the **Invoice** tab.
   **Expected:** **no invoice is shown** — the tab still reads *"No invoice
   yet."* A draft is the tradesperson's private working copy. Check the client's
   dashboard too: no invoice notification, no email.
5. Tap **New invoice** again as the tradesperson (or double-tap it).
   **Expected:** no second invoice and **no second invoice number burned** — you
   land back on the same draft.
6. **Send** it (needs Stripe payouts set up — see 6.2). As the **Client**, reload
   the job. **Expected:** the invoice is now visible on the Invoice tab, payable
   by card, with the same lines you typed. Back on the tradesperson side the job
   has moved to **Awaiting payment** (kanban column too), the chat carries a
   *"sent invoice INV-… — $X due"* line, and the **Mark as paid** card is now
   showing. Before this it stayed **In progress** with no way to close it out.
7. **The wipe check.** On a *different* in-progress job, write two lines by hand
   in the Invoice tab, **Save**, then open the wrap-up sheet (**Create invoice**
   → *Finished the work?*). **Expected:** your hand-written lines are already
   there as **Extras & charges** rows (and any discount is carried in), so
   sending for approval bills them — it does **not** silently drop them. Confirm
   the approved total the client sees includes both lines exactly once.
8. Mobile (375px): the create card, the editor's line-item table (scrolls
   horizontally) and the totals are all reachable and tappable.

---

### 6.7 Close a job out without the client → help: `quotes-and-invoices`

The seam: a tradesperson running a job end-to-end must be able to reach
**Complete** on their own. Previously a job with a client attached could only
leave `awaiting_client_approval` when the client tapped approve, and
`markJobPaid` only accepts `awaiting_payment` — so a client who never logs in
left the job stuck forever.

1. As the **Tradesperson**, on an in-progress job **with a claimed client**,
   open the wrap-up sheet (**Create invoice** → *Finished the work?*) and go to
   the **wrap-up** step. **Expected:** a **"Finish without client approval"**
   tick-box under the note field, **off** by default, and the submit button
   reads **Send for approval — $X**.
2. Tick it. **Expected:** the button changes to **Finalize invoice — $X**, and
   a line appears explaining the client still gets the invoice.
3. Submit. **Expected:** the job goes straight to **Awaiting payment** (not
   *Awaiting client approval*), the invoice is **sent** (not draft), and the
   **Mark as paid** card is showing. The chat carries one line only — *"…
   finalized the invoice"*, **not** a duplicate *"Status changed to Awaiting
   payment"*.
4. **As the Client** on that job: **Expected:** they were still notified and can
   still view + pay the invoice — they were simply never asked to approve the
   wrap-up. There's no approve / request-changes banner.
5. Back as the tradesperson, tap **Mark as paid**. **Expected:** invoice →
   **paid**, job → **Complete**, review prompt appears. The loop closed with no
   client action at any point.
6. **The control.** Repeat on another job leaving the box **unticked**.
   **Expected:** unchanged behaviour — `awaiting_client_approval`, draft
   invoice, client sees the approve banner.
7. On a **solo job (no client)**: **Expected:** the tick-box isn't shown at all
   (there's nobody to approve) and the button already reads **Finalize
   invoice**.
8. Mobile (375px): the tick-box, its explanation and the submit button all fit
   without horizontal scroll.
9. **Solo job that never started (issue #28).** On a solo job still at a
   pre-work status (`requested` / `quoted` — the work happened off-app):
   **Expected:** the jobs-list status menu offers **Complete job**, and the
   Invoice tab shows the *Finished the work?* wrap-up card. Finishing works
   exactly as in step 3 — job → **Awaiting payment**, invoice **sent**. A job
   **with a client** at the same status must NOT offer Complete job.
10. **Hand-written invoice on a solo job, no Stripe payouts.** As a
    tradesperson who has NOT set up payouts, hand-write a draft invoice
    (**New invoice**) on a solo pre-work job. **Expected:** no payouts
    blocker card and **Send** is enabled (a job with a claimed client still
    shows the blocker). Send it: invoice → **sent**, job → **Awaiting
    payment**, then **Mark as paid** → **Complete**.

---

### 6.8 Invoice / quote PDF file size → help: `quotes-and-invoices`

A branded invoice PDF was shipping at ~45 MB: the Blue Seal lockup is a
6250x1718 RGBA PNG, jsPDF expands RGBA into a raw RGB stream plus an alpha
mask, and no stream compression was on. Unusable over email or a phone
connection, so it needs a size check, not just an eyeball check.

1. As the **Tradesperson**, on any job with an invoice, tap **View PDF**
   (desktop) or **Download PDF** (mobile). Save the file.
2. **Expected:** the file is **well under 1 MB** (a typical one-page invoice
   lands in the low hundreds of KB). Anything in the tens of MB is the bug.
3. Open it. **Expected:** the navy header band shows the Blue Seal lockup
   crisply, with **no black box** behind it — the logo's transparency survived.
   Text is sharp at 200% zoom.
4. Repeat on a **quote** PDF (same renderer) and on a **Blue Seal Pro** account
   with a **custom logo, brand colour and letterhead banner** set. **Expected:**
   same size ceiling and same crispness, and a photo-heavy banner does **not**
   blow the file up.
5. Mobile (375px): the download lands in the OS viewer and opens.

---

## 7. Reviews → help: `mutual-reviews`

1. On a **Complete** job: as the **Client**, leave a public review (overall +
   quality/punctuality/communication/value). As the **Tradesperson**, leave a
   **private** review of the client.
2. **Expected:** reviews are **blind until both** are submitted; the public review
   shows on the tradie's profile and updates their rating. **Solo/invite jobs
   never produce public reviews.**

---

## 8. Blue Seal Pro & the paywall → help: `blue-seal-pro`, `clients-and-recurring-billing`

### 8.1 Start a real trial (Stripe path)

1. As a tradesperson **without** Pro, start the trial via the upgrade flow →
   Stripe Checkout (card required, `4242…`).
2. **Expected:** status becomes **Trialing** (30 days); the billing portal lets
   you cancel/switch. _(For most QA, just toggle Pro instantly in `/qa` instead.)_

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

1. **Role switching (all three surfaces stay in sync).** As an account holding
   several views (e.g. Client + Tradesperson + Project manager + Sales + Admin),
   check each switcher: **(a)** the header avatar menu lists a "Switch to X view"
   item for every view you hold _except_ the one you're in; **(b)** the side
   panel "Viewing as" **dropdown** opens to the same full list (no truncated
   "C.. T.. A.." labels) with the current view marked active; **(c)** Account →
   Your roles lists every view with an "Active" badge on the current one and a
   "Switch to this view" button on the rest. **Expected:** all three show the
   same views with the same label + icon, switching from any of them flips the
   view (and plays the switch animation). `qa` never appears as a switchable
   view. → `switching-roles`
2. **Account & profile** — edit profile, notification prefs. → `notifications`
3. **Email notifications** — key events (new request, quote, message, invoice)
   send a branded email.
4. **Per-view notification badges (multi-role accounts).** As an account that
   holds more than one view (e.g. admin + tradesperson + sales), open the
   notifications bell. **Expected:** each row carries a coloured left edge + a
   small icon-and-label chip naming the view it's for (Client / Tradesperson /
   Admin / Sales), and the matching branded email shows a "● ROLE view" pill at
   the top of the card. A **single-role** user sees **no** badge (one context,
   so it'd be noise). Check at 375px — the chip wraps under the body, never
   clipping the title.
5. **PWA install** — install to home screen (iPhone/Android/desktop). → `install-the-app`
6. **In-app update (the banner must not loop).** With the app already open on an
   older build, ship a new build. **Expected:** within ~30s (or on tab refocus) a
   "A new version of Blue Seal is available" banner appears; tap **Update** → the
   app reloads **once** to the newest build and the banner **does not come back**.
   Test the worst case too: an **installed iOS PWA** from the home screen — tap
   Update, confirm a single reload lands the new build (no repeating popup). A
   `critical` release shows the blocking "Update required" overlay instead; same
   one-tap, single-reload result.
7. **Help Center** — browse `/help`, search, open an article and a FAQ. →
   `report-a-problem`
8. **Vanity profile URL resolves (regression).** As a **Pro tradesperson with a
   claimed handle**, open **My page** (side panel, or `/tradies/<your-uid>`).
   **Expected:** the URL swaps to `/u/<your-handle>` and the profile **renders**.
   It must **not** show "Profile not found". Check it signed-out too (paste
   `/tradies/<uid>` in a private window) and from a **vouch chip** on another
   tradesperson's profile — navigating profile-to-profile must load the new
   person, not keep showing the previous one. (Both routes render the same
   component, so the page has to re-resolve on a route change, not just on mount.)

---

### 9.x Avatar dropdown fits narrow phones

1. Sign in as an account that holds **several roles** (an admin who is also a
   tradesperson, sales rep and project manager is the worst case — it produces
   the longest labels, e.g. "Switch to Project manager view").
2. At **375px** and **402px**, open the avatar dropdown in the header.
   **Expected:** the popup sits **inside** the viewport with a visible gutter on
   both sides — it must not run edge-to-edge or look cut off. Long labels
   **wrap to a second line**; none is truncated, and the icon stays aligned with
   the first line.
3. Read **every** item end to end: Find a tradesperson · Post a job · Dashboard ·
   Account · each "Switch to … view" · Help & support · Sign out. No ellipsis, no
   text disappearing off the left edge.
4. **No sideways scroll.** `<body>` is `overflow-x: clip`, so an over-wide popup
   is clipped *silently* with no scrollbar to reveal it — that was the bug.
   Confirm the page still doesn't scroll horizontally with the menu open.
5. Same check with the **browser font size increased** (Settings → larger text),
   which is what pushes a borderline label over the edge on a real device.
6. Spot-check one other popup menu (a job's action menu on the jobs list) at
   375px — the fix is global to `.p-menu`, so nothing else should have shifted.

---

## 10. The QA toolkit itself → (no help article; internal)

1. **Provision** yourself as a tradesperson on a given trade (`/qa`) → confirm you
   appear in client **search** and can **browse jobs**.
2. **Toggle Pro** on → AI unlocks + client fee waived; off → paywall returns.
3. **Reset my data** → your jobs/posts/applications are gone, profile back to
   draft; re-provision and re-run.
4. **File a bug** via the floating button (paste a screenshot) → confirm it
   appears in **My bug reports** (`/qa`) and in **admin triage** (`/admin/bug-reports`).
5. **Error log** — trigger nothing special; just confirm `/qa` → _Error log_ lists
   recent captured errors and you can mark one **Resolved**.
6. **Batched "your bug report is fixed" notice.** File two bugs from the floating
   button, then (as an admin) open `/admin/bug-reports` and flip **both** to
   **Fixed**, plus a third one to **Wontfix**. The digest is a scheduled sweep
   (`scheduledBugFixNotices`, 09:00 America/Vancouver), so either wait for the
   next run or trigger it from the Cloud Scheduler console / emulator shell.
   **Expected:** the reporter gets **exactly one** in-app notification + email —
   "2 of your bug reports are fixed", listing both titles, linking to
   `/admin/bug-reports`. The **wontfix** report is **not** mentioned. Run the
   sweep a second time: **no** new notification (each report carries
   `fixNotifiedAt` once announced). Flip a fourth report to Fixed and re-run:
   a fresh notice naming **only** that one. Check the bell at **375px** — the
   row wraps rather than clipping.
7. **Browse-area override (job board).** Provision yourself as a tradesperson,
   then open **Browse open jobs**. Use the QA-only **"QA: browse area"** dropdown
   (only the qa role sees it) to pick a preset city (e.g. Toronto).
   **Expected:** the feed re-centres on that city **without** changing your saved
   service area; the radius slider goes up to **5000 km for QA** (500 km for a
   normal tradesperson). "My saved area" returns to your own location, and the
   pick **sticks across navigation** (reload the page → still set). This lets you
   test postings in any region without editing your profile.

---

## 11. Sales reps → (rep-internal; no public help article)

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
7. **Rep reviews + approves an owned application (full vetter tooling).** As a
   signed-in rep (with a region or a referral), open **/sales → Applications to
   review**. **Expected:** you see the pending tradespeople in your region, or
   who used your code. Open one → **Expected:** you get the SAME trust tooling
   admin has: certifications with a **verify-on-registry** helper, **insurance**
   and **WSIB** cards, and an **inline document viewer** (with a "REP VIEW ONLY"
   watermark on the ID + the liability-release signature) instead of raw new-tab
   links. Tap **Approve** → **Expected:** the tradesperson goes live and the
   application leaves your queue.
8. **Rep can't touch others' applications.** A pending tradesperson in a
   DIFFERENT region (and not your referral) does NOT appear in your list, and the
   server denies a decision call on them. Admin still sees + vets everyone from
   **/admin/vetting** — and each queue row now shows the **region + assigned rep**
   attribution, with **"Approved by"** on the approved-not-live rows + the review
   header, so admin can audit who vetted whom.
9. **Commission accrues on a referred tradie's revenue (money seam).** This is
   server-side: commissions are written by the Stripe webhook and there is no
   the rep now sees their running balance at **/sales/payouts** (path 11.11), but
   to confirm the exact ledger entry verify in the **Firebase console**
   `commissions` collection. Take a tradesperson who
   signed up via your code (step 5) to **live**, then run them to a **card-paid
   invoice** (6.2) while they are **not** Pro (so the platform service fee
   applies). **Expected:** one `commissions` doc with id `service_fee_<invoiceId>`,
   `repId` = the owning rep, `ownerKind` "referral", `source` "service*fee",
   `status` "accrued", and `commissionCents` = **10%** of the fee's platform
   portion. Exactly one doc, and a webhook retry never adds a second. Then make
   them **Pro** and pay another card invoice. **Expected:** the fee is waived to
   $0, so **no** new commission is written (nothing for the platform to share). A
   real **Pro subscription** payment (8.1) writes a `subscription*<stripeInvoiceId>`
   doc at 10% of the amount charged; the referral **free comp month** writes
   nothing (there is no Stripe charge behind it).
10. **Commission reverses on a refund / lost chargeback (money seam).** From step
    9, **fully refund** the card-paid invoice (admin / Stripe test mode).
    **Expected:** a second doc with id `service_fee_<invoiceId>_reversal`,
    `status` "reversed", `reversalOf` the original id, mirroring the original
    amount; the original accrual is left untouched (the ledger is append-only and
    payouts net accrued minus reversed). A refund retry never adds a second
    reversal. **Partial refund is now PROPORTIONAL:** a 30% refund reverses 30%
    of the commission (`round(commission × amount_refunded/amount)`) on the same
    `_reversal` doc, and a later larger partial refund escalates it upward (never
    double-counts). A dispute that closes **won** (or without loss) leaves the
    commission intact; only a **lost** chargeback reverses it (fully).
    10b. **Upfront-fee commission (money seam).** On a PM-driven job with an upfront
    fee, pay the upfront by card (6.1). **Expected:** rep + PM commission accrue
    keyed `service_fee_upfront_<jobId>` (distinct from the final invoice entry),
    each 10% of the upfront's platform portion. Refund the upfront → matching
    `_reversal` docs, proportional to the refund.
11. **Rep dashboard + payout onboarding.** As a signed-in rep, open **/sales**.
    **Expected:** an "Earnings & payouts" card shows your **unpaid balance** and
    **paid to date**, plus cards for Applications and your referral code. Open it
    (or the **Earnings** nav item) to reach **/sales/payouts**. **Expected:** the
    unpaid balance matches your accrued commission (net of any reversals), an
    **"Earnings by tradesperson"** card breaks down the lifetime net per
    tradesperson (refunds netted, negatives flagged), and a
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

## 12. Admin — all jobs & postings → (admin-internal; no public help article)

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

## 13. Project managers → (real estate agents, property managers, landlords; help article pending)

> A **project manager** (PM) recommends trades, sets up jobs for their clients, and
> earns a referral commission. Self-serve, **no vetting**: the role enables instantly
> and the cockpit lives at `/manage`. The agreement is signed later (at payout setup),
> not before using the cockpit. Shipped: role + cockpit (P1), trusted trades +
> recruiting (P2), properties (P3a), projects + compare-and-choose dispatch + PM
> visibility (P3b), and the additive PM commission + payouts (P4). The public PM
> profile (P5) is the remaining phase.

1. **Sign up as a project manager (password).** On `/sign-up` pick **A project
   manager**, fill name/email/password, agree to terms, create the account.
   **Expected:** account created; you land on the **/manage** cockpit (the
   "Project manager" pill + the trusted-trades / projects / earnings section cards).
   No referral-code field and no agreement dialog (the agreement comes at payout).
2. **Become a PM from an existing client.** Sign up with Google (or as a client), and
   on the **/welcome** screen choose **I manage projects or properties** (or, as an
   existing client, use the same path). **Expected:** the project-manager role is
   added and you land on `/manage`. Your account now holds both **client** and
   **project manager**.
3. **Switch views.** Open the role switcher (side panel / avatar menu).
   **Expected:** a **Project manager** pill appears alongside **Client**; switching
   flips the view with the role-switch animation, and `/dashboard` routes a PM to
   `/manage`.
4. **Cannot forge PM identity (rules).** The `projectManager` object on the user doc
   is server-managed; the client cannot write it (covered by
   `tests/rules/projectManager.test.ts`).
5. **Roster: add a tradesperson already on Blue Seal.** In the cockpit **Roster**
   (`/manage/trades`), under "Already on Blue Seal?", search a visible tradesperson by
   name and tap **Add to roster**. **Expected:** they appear instantly under **On your
   roster**, and the search result flips to a "On your roster" badge (no duplicate add);
   **Request** opens a fresh quote to them; the **x** removes them. The same list shows
   under **Saved trades** on the client dashboard. (Reuses the existing `savedTradies`
   shortlist.)
   5a. **Roster: search reaches unverified + profile-less tradespeople.** Search the name of
   a tradesperson who isn't verified yet (`isVisible` false, mid-onboarding) or who has the
   tradesperson role but never built a profile at all. **Expected:** they now appear in the
   results with a "Not verified yet" note and can be added (the old client-side search only
   saw publicly-visible tradies, so these were missing entirely). On the roster they render
   with the same status and **no Request button** (you can only send a job once they're
   live, matching the vet-before-go-live rule). Search + hydrate go through the PM-gated
   `searchRosterCandidates` / `getRosterCards` callables (admin SDK, sanitized card) because
   firestore.rules block a PM from reading a hidden tradie doc directly.
6. **Roster: invite a tradesperson who isn't on Blue Seal (the acquisition link).** In
   the **Roster** page's "Or share your invite link" card, claim/copy the
   `/join?pm=CODE` invite link (tap the QR to enlarge it full-screen for scanning). Open
   the link in a fresh session: signup preselects **tradesperson** with the free-month
   banner. Complete a tradesperson signup through it. **Expected:** once that tradesperson
   goes live (vetted), they appear on the PM's roster and get a free first month of Pro
   (granted at go-live, like a rep code). Sanity: the rep `?ref=` link still works
   unchanged. (Server attribution: `users/{tradieUid}.referredByPmId`.)
   6a. **Roster: email invite a tradesperson by name + email.** In the **Roster** page's
   "New to Blue Seal? Email them an invite" card, enter a name + a fresh email and **Send
   invite** (`sendRosterInvite`). **Expected:** a row appears under **Invites** as pending
   ("Invited just now") and the recipient gets a CASL-compliant email (mailing address +
   working unsubscribe) with a "Join Blue Seal" link to `/sign-up?as=tradesperson&invite=…`.
   Complete that signup as a **tradesperson** with the same email. **Expected:**
   `linkRosterInvitesOnSignup` adds them to the PM's `savedTradies`, stamps
   `referredByPmId` (free Pro month at go-live), and the **Invites** row flips to
   **Joined**. Edge checks: inviting an email that already has an account is rejected with
   a "search their name" message; **Cancel** revokes a pending invite; the email's
   unsubscribe link (`/roster-invite-unsub`) suppresses future invites to that address.
7. **Properties book.** In the cockpit "Properties" section, add a property
   (label + optional address + notes), edit it, then archive it. **Expected:** it
   appears in the list and persists; archive drops it from the default list.
   Properties are private to you (the PM); a connected client account can read its
   own property once linked (P3b).
8. **Projects: set up, invite, claim, accept (P3b-1).** In the cockpit "Projects"
   section, **New project**: name it, enter a client name + email, optionally pick
   a property, add one or more jobs (each = trade + title + description), then
   **Create & invite client**. **Expected:** the project lists with an **Invite
   sent** tag; an invite link is shown to copy (the email also goes out when the
   CASL mailing address is configured).

   **Photos per job (same as a client posting).** Each job in the form has a
   **Photos** picker under its description: attach up to 8 images per job (they're
   compressed + uploaded exactly like the client job-post step — same pipeline,
   same `jobPosts/{uuid}/photos/` storage). Photos are optional. They ride the job
   spec through accept/dispatch, so the **posting the invited contractor sees**
   carries the same photos a client-posted job would. Works in **New project**,
   **Edit project** (pre-accept), and **Add jobs** (post-accept). **Expected:**
   thumbnails appear inline with a remove (✕); after the client accepts, open the
   posting as the invited contractor and confirm the photos show there too. Verify
   at 375px.

   **Roster-coverage hint (while adding jobs).** As you pick each job's trade, the
   form tells you whether it will reach your roster: a green "**N of your trades
   will be invited**" when you have a match, or an amber "**No saved trade for this
   — it'll go to the public board**" when you don't. **Expected:** the warning is
   live (add a matching trade to your roster and it clears) — it's the pre-accept
   catch for the empty-scope dispatch.

   **Re-copy the invite link later.** Re-open a pending project and tap **Resend
   invite**. **Expected:** a fresh "**Shareable sign-in link**" appears with a Copy
   button for the **same** client email (not only on an email change), and the
   client is re-emailed; the newest link is the one that works. _(Requires the
   `resendProjectInvite` function deploy — see HUMANTASKS.)_

   Open the invite link (or the emailed
   magic link) in a fresh session, confirm the client's email, sign in, and confirm
   the claim. **Expected:** you land on the client dashboard with a **"Projects set
   up for you"** card listing the jobs and **Accept**. Accept opens an **address
   form** (where the work is); fill it and **Confirm & accept**. **Expected:** the
   card flips to **Accepted**, and back in the PM cockpit the project shows
   **Accepted** (the PM gets a notification). Decline on a second project instead
   and confirm it shows **Declined**.

9. **Dispatch + compare-and-choose (P3b-2).** Pre-req: the PM has at least one
   **saved trade** whose trade matches a job in the project, and that tradesperson
   is **visible/approved**. After the client accepts (path 8), sign in as that
   tradesperson and open the **"You've been invited to quote"** notification (in-app
   bell + the email CTA). **Expected:** it deep-links straight to that scoped posting
   (`/jobs/posted/:id`), not the generic Browse list. (A tradie who matched more than
   one posting in the same dispatch falls back to Browse → **"Invited to quote"**.)
   The posting is also reachable the manual way via **Browse jobs** → an **"Invited to
   quote"** section (visible even with no service area set; NOT in the public radius
   feed). Open it, submit a full quote. Sign back in as the client,
   open the posting from **Posted jobs**, and **accept** the quote (sign).
   **Expected:** a real job is created carrying `projectId`, `propertyId`, and
   `drivenByProjectManagerId` (the winner was a preferred contractor — the
   commission trigger, P4). A tradesperson NOT on the PM's list never sees the
   posting.
   9b. **Public-board fallback (P3b-2b).** On a scoped posting with no quotes, the
   client opens the posting (from **Posted jobs**) and taps **Open to all trades
   nearby**. **Expected:** the posting flips to **Open**, drops out of the invited
   contractors' "Invited to quote" lists, and now appears in the normal radius feed
   for any verified tradesperson in the area (its address is geocoded at this step).
   A preferred contractor who still wins after the fallback keeps the
   `drivenByProjectManagerId` stamp (commission); an off-list public winner does not.
   9c. **PM read-only visibility (P3b-3).** In the cockpit, tap a project to open its
   detail (`/manage/projects/:id`). **Expected:** each job shows its posting status;
   while quotes arrive you see the **amounts** (to broker the pick); once the client
   picks a contractor, that job shows the **winner + job status + scheduled dates**.
   You never see the job **chat** or the **invoice** (financial firewall: rules
   expose only the job doc to the driving PM, never `chats/` or `invoices/`). A PM
   cannot open another PM's project or postings. (Covered by the PM-read tests in
   `tests/rules/jobPosts.test.ts` + `tests/rules/jobs.test.ts`.)
10. **Project money / permission seam (rules).** The project doc is server-managed:
    the client cannot forge `status` (no direct write) and only the project's own
    client can accept/decline; only the owning PM or linked client reads it. A scoped
    posting is readable + appliable only by an invited contractor (`status:"invited"`

- `invitedContractorIds`), and the job's PM fields are pinned immutable against
  party writes (covered by `tests/rules/projects.test.ts`, the invited-post tests
  in `tests/rules/jobPosts.test.ts`, the jobs-update pins, and `respondToProject`
  unit tests).
  10b. **PM commission accrues on payment (P4).** Take a PM-driven job (path 9, won by
  a preferred contractor) through to a **card-paid** invoice. **Expected:** TWO
  commission ledger entries accrue on the same fee — the tradesperson's rep (if any)
  AND the PM, each 10% of Blue Seal's platform portion, with distinct deterministic
  ids (`service_fee_<inv>` and `service_fee_<inv>_pm_<pmId>`). A full refund / lost
  dispute reverses BOTH. A public-fallback win by an off-list contractor accrues NO
  PM entry (not PM-driven). Pro-waived fee = no entries. (Verify on real Firestore +
  Stripe test mode; covered by `commissionAccrual` unit tests.)
  10c. **PM earnings + payouts (P4).** In the cockpit **Earnings** section: see the
  unpaid balance + paid-to-date. Tap **Review & sign the agreement** (signature pad)
  → then **Start Stripe setup** (Connect Express onboarding) → return to `/manage`.
  **Expected:** once Stripe reports payouts enabled, the panel reads "Payouts are
  live"; the monthly scheduler pays the PM the same way as a rep ($50 min,
  claim-before-pay) once their balance clears. The agreement gates payout setup only,
  never the cockpit. A PM reads only their own commission/payout entries (rules).
  10d. **Public profile (P5a).** In the cockpit **Public profile** section: edit the
  business name + about + brand colour, upload a logo + cover, then **Claim** a
  `/pm/<handle>` link (3-30 lowercase letters/numbers/hyphens; reserved words
  rejected) and **toggle Publish on**. **Expected:** open `/pm/<handle>` (signed out
  / incognito) and see the published profile (cover, logo, name, about). With Publish
  **off**, the same link reads "Profile not found" to the public, but the owner sees
  a preview banner. No vetting/review gate; publishing is instant.
  10e. **PM navigation + dashboard (UX redesign).** As a project manager, confirm the
  **side nav is PM-specific** (Dashboard, Properties, Jobs, Trades, Earnings, Public
  profile) — NOT the client nav. **Expected:** `/manage` is a Dashboard overview (stat
  tiles for properties / active projects / jobs in progress / unpaid earnings, quick
  actions, a payout-setup nudge, recent projects), and each nav item / tile routes to
  its own section. Mobile bottom bar = Dashboard + Properties + Alerts.

**First-run Get started checklist.** As a _brand-new_ PM (empty roster, no
projects), the dashboard shows an ordered **Get started** card above the tiles with
three steps — **Add your trusted trades** (listed first, on purpose), Add a property,
Set up your first project — each with a button into its section and an `x/3 done`
counter. **Expected:** completing a step ticks it off (line-through, check icon);
the card disappears once you have **≥1 roster trade AND ≥1 project** (a property is
recommended but optional). The "trades first" order matters: a project created with
an empty roster dispatches to nobody and falls back to the public board.
10f. **Property -> Projects -> Jobs drill-down.** From **Properties**, tap a property to
open it; tap **New project here** and create a project (it's scoped to that property,
no property picker). **Expected:** the project appears under that property and opens
to its read-only jobs/quotes; the Dashboard "recent projects" and the **Jobs** board
(every PM-driven job, read-only) also reflect it.
10g. **Photos on properties + projects.** Add/edit a property and attach a **photo**;
create a project and attach a **photo**. **Expected:** the photo shows as a hero on
the property + project detail pages and as a thumbnail on the lists + dashboard; the
client invited to the project can see the project photo (world-read storage).
10h. **Find / feature trades + contractor opt-out (P5b).** In **Trades**, tap **Find a
tradesperson** -> search -> Save one. In **Public profile -> Featured trades**, toggle
that saved trade **on**. **Expected:** they appear under "Trades I recommend" on your
public `/pm/<handle>` page (each card -> request a quote), and the contractor gets a
`pm_featured` notification. As that contractor, open **/featured-by-pms** and tap
**Remove me**. **Expected:** they drop off the PM's profile and can't be re-featured
until they opt back in (covered by `featuredContractors.test.ts` + rules tests).
10i. **Business card (QR to public profile).** From the **dashboard** tap **My business
card** (or **Public profile -> Business card**, route `/manage/card`). Pick a theme
(Cream/Navy), tweak the scan caption + optional phone, then **download the 2-sided
PDF** and a **PNG**. Scan the QR with a phone. **Expected:** the card shows your
name/brand + the trades you recommend (from your featured contractors); the QR opens
your public profile (`/pm/<handle>`, or `/project-managers/<uid>` if you haven't
claimed a handle). If your profile isn't published yet, a warning tells you to publish
it first (so the scan resolves for clients).
10j. **PM tools expansion (2026-06).** A batch of cockpit additions; the Pro ones gate
behind the **same Blue Seal Pro subscription tradespeople use** (a PM can subscribe
through the normal paywall → trial → Stripe, no "add the tradesperson role" bounce).

- **Welcome email.** Become a PM → a one-time "Welcome to Blue Seal" email + in-app
  notification arrives, linking to `/manage` (re-adding the role doesn't re-send).
- **Restore archived property.** Properties → archive one → **Archived (N)** section
  → **Restore** → it's back in the active list.
- **Multi-unit.** Edit a property → add **units** (chips) → Save (card shows "N
  units"). New project on it → a **Unit** picker appears → pick one → the unit shows
  on the project detail + the property's project list.
- **Edit a project.** On a pending project, **Edit project** → change label / add a
  job → **Save changes**. Offered only pre-accept (server rejects edits after accept).
- **Add jobs after accept (client approves each).** On an **accepted** project,
  **Add jobs** → add a job (trade+title+desc), optionally **Draft jobs** with AI →
  **Send to client for approval**. The job lands under "Awaiting your client's
  approval" as **Pending client** (no posting yet) and the client is notified; it
  does **not** dispatch until they approve. As the client (dashboard → "Projects set
  up for you"), **Approve** dispatches that one job to the matching saved trades
  (no address re-asked — reuses the accept address) and notifies the PM; **Decline**
  marks it Declined on the PM detail and notifies the PM. The headline job count
  ignores declined adds. (Requires the `proposeProjectJobs` + `respondToProjectJob`
  function deploy.)
- **Roster availability.** Roster cards show each contractor's available weekdays.
- **Clients (Pro)** `/manage/clients`: all clients gathered from your projects,
  searchable, active/total counts. Non-Pro → the Pro gate.
- **Calendar (Pro)** `/manage/calendar`: every scheduled job across your projects on
  the read-only calendar. Non-Pro → the Pro gate.
- **Branded profile + business card (Pro).** Non-Pro PMs see the Pro gate on Public
  profile + Business card.
- **AI — draft a project (Pro).** New project → "Draft the jobs with AI" → describe
  the work → **Draft jobs** → rows populate to review. Non-Pro → paywall.
- **AI — Catch me up (Pro).** Dashboard → **Catch me up** → a plain-language status
  digest (status only — never the chat/invoice). Non-Pro → paywall.

11. **Mobile (375px).** Re-run the signup cards + cockpit + saved-trades + properties +
    projects (incl. the client accept + address form), the tradesperson "Invited to
    quote" section, the cockpit Earnings + Public-profile editors, and the public
    `/pm/<handle>` page at 375px. **Expected:** the role cards stack and stay tappable;
    the cockpit cards, the new-project form, the accept address form, and the public
    profile read cleanly.

---

## Coverage checklist (tick as you complete a full pass)

- [ ] 1.1 Client sign-up
- [ ] 1.2 Tradie onboarding — no docs (submit blocked)
- [ ] 1.3 Tradie onboarding — ID only (still blocked)
- [ ] 1.4 Tradie onboarding — cert+ID, no insurance (approved + visible)
- [ ] 1.5 Tradie onboarding — all docs incl. insurance (Insured badge)
- [ ] 2.1 Client posts a job to the board
- [ ] 2.2 Client direct-requests a quote
- [ ] 2.3 Tradie creates an invite/solo job (single-trade auto-selected; optional 1-8 photos; magic-link email to client)
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
- [ ] 6.5 Payout setup recovers from an orphaned Stripe account id
- [ ] 8.1 Pro trial (Stripe)
- [ ] 8.2 AI paywall + receipt OCR free
- [ ] 8.3 Recurring billing drafts (never auto-sends)
- [ ] 9 Role switch / notifications / PWA install / in-app update banner (no loop, incl. installed iOS PWA) / Help Center
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
- [ ] 13.1 Sign up as a project manager (card) → lands on /manage
- [ ] 13.2 Become a PM from /welcome → /manage, holds client + project manager
- [ ] 13.3 Role switcher shows Project manager; /dashboard routes PM to /manage
- [ ] 13.4 Roster: search a tradesperson by name → Add to roster (in-cockpit); appears under On your roster + result flips to badge; Request re-hires; x removes
- [ ] 13.5 Roster invite link: claim code; tap QR → full-screen; /join?pm= signup → tradesperson; free month at go-live + appears on PM roster; rep ?ref= unaffected
- [ ] 13.6 Roster email invite: name+email → Send (sendRosterInvite); pending row + compliant email; tradesperson signup w/ same email auto-joins roster + sets referredByPmId; row flips Joined; existing-account rejected; Cancel revokes; unsubscribe suppresses
- [ ] 13.6 Properties: add / edit / archive a property in the cockpit
- [ ] 13.7 Projects: create + invite a client → claim via magic link → accept (address form) / decline on the dashboard
- [ ] 13.8 Dispatch: accepted project fans each job to matching preferred contractors ("Invited to quote"); client compares + accepts; won job carries projectId + drivenByProjectManagerId
- [ ] 13.8b Add jobs after accept: PM Add jobs on an accepted project → Pending client (no posting, client notified); client Approve dispatches that one job + notifies PM; Decline marks Declined + notifies PM; count ignores declined (proposeProjectJobs + respondToProjectJob)
- [ ] 13.9 Project seam: client can't forge status; invited posting readable/appliable only by an invited contractor; job PM fields pinned (rules + unit tests)
- [ ] 13.10b PM commission: card-paid PM-driven fee accrues BOTH rep + PM 10% (distinct ids); refund reverses both; off-list public win accrues none
- [ ] 13.10c PM earnings/payouts: sign agreement → Stripe Connect → monthly payout ($50 min); agreement gates payout only; PM reads only own ledger
- [ ] 13.10d Public profile: edit brand/bio, upload logo+cover, claim /pm/<handle>, publish on → world-visible; off → not found to public, preview to owner
- [ ] 13.10e PM nav + dashboard: PM-specific side nav (not client); /manage overview with stat tiles + quick actions routing into sections; new-PM Get started checklist (trades first) ticks off + hides once activated
- [ ] 13.10f Property → Projects → Jobs drill-down; New-project scoped to a property; Jobs board reflects PM-driven jobs
- [ ] 13.10g Photos: attach a photo to a property + a project; hero on detail, thumbnail on lists, visible to the invited client
- [ ] 13.10h Find/feature trades: search → save; feature on profile → public card + pm_featured notif; contractor /featured-by-pms → Remove me (opt-out)
- [ ] 13.10i Business card: /manage/card → theme + caption → download 2-sided PDF + PNG; QR opens /pm/<handle> (or /project-managers/<uid>); warns if profile unpublished
- [ ] 13.10 Public fallback: client opens a no-bid scoped posting to the board (geocoded, leaves the invited lists, enters the radius feed)
- [ ] 13.11 PM visibility: project detail shows quote amounts + won-job status/schedule; never the chat/invoice; another PM is denied
