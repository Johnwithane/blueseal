# QA audit — Job lifecycle + money path (run C)

**Scope:** The full job lifecycle and money path, as the two real single-role accounts (`qa-client`,
`qa-tradie` — NOT the all-roles admin). Accept an itemized application quote (with the uninsured
waiver) → work order + tradesperson waiver → change order (propose/approve) → time entry → expense
(receipt-OCR path) → invoice build from billables → payment → terminal paid → blind mutual reviews →
receipt. Primary viewport **375×667**. Local emulator suite, project `blueseal-762af`.
**Date:** 2026-07-07. **Tester:** qa-runner (Playwright MCP).

**Accounts (password `QaPass!2026`):** `qa-client@blueseal.test` (plain client),
`qa-tradie@blueseal.test` (approved Electrician, **uninsured**, Stripe payout onboarding **incomplete**).

**Artifacts left behind:** open post `pWUcfSfCRSWvts2GiQRP` converted to **job `IxUmZzqSI5ptFAkNpR7i`**,
which is now **Complete / invoice INV-2026-0001 paid ($211.00) / both reviews submitted & revealed**.
This is a terminal, fully-closed job — nothing left pending for a future run on it.

**Known bugs from runs A/B, worked around (not re-reported):** every sign-in lands on `/` (navigated
manually); cancelled-post dead-end; dev-only `manifest.webmanifest` console error (the 2 persistent
`[ERROR]`s on every route).

---

## Invoice-math verdict (the headline question)

**Line items reconcile EXACTLY. The one discrepancy is TAX.**

- Billables accrued: Time **$85.00** (1h @ $85/hr) + Expense **$46.00** (materials, $40 paid × 15%
  markup = client-pays $46) + Approved change order **$80.00** (flat) = **Subtotal $211.00**.
- Invoice INV-2026-0001 lines: Labour $85.00 / 20A breaker + junction box hardware $46.00 / Replace
  corroded junction box $80.00 → **Subtotal $211.00** — matches to the cent.
- The approved extra is correctly **excluded** from "Charges so far" until the client approves it
  ($85 → $85 → $165 → tradie-side $211 as each piece lands). The hourly quote's estimate ($255/3h) and
  its **$65 materials line are correctly NOT auto-carried** — the $65 is offered as an *optional*
  "From your quote" add so it can't double-count against the actual $46 expense. Good design.
- **Discrepancy: Tax = $0.00** on the invoice, vs the accepted quote's **13% ($41.60 on $320)**. See H1.

So: **quote-billables → invoice = YES on line items ($85+$46+$80=$211); NO on tax (0% vs the quoted 13%).**

---

## Notification-type verdict (the "masquerades as invoice" suspicion)

**Did NOT reproduce.** Every quote/extra/chat event is correctly and distinctly typed on both sides:
- Client bell: "New tradesperson applied" · "New change order: … — $80.00. Open the job to approve or
  decline." · "QA Tradie sent you a message".
- Tradie bell: "Your quote was accepted! Q-2026-0001 ($361.60)…" · "Change order approved: …" ·
  "QA Client Edited sent you a message".

No quote/extra event was mislabeled as an invoice notification. (One stale-notification nit — see L2.)

---

## Top 3 to fix first

1. **H1 — Invoice ships with $0.00 tax by default** on all job-accrued billables (every line 0.0%),
   inconsistent with the accepted quote's 13%. A GST/HST-registered tradesperson silently under-collects.
2. **M1 — Receipt OCR reports "Receipt read" success on a totally empty parse** (all fields null),
   leaving a blank $0.00 "Unknown vendor" expense that looks parsed.
3. **M2 — Client's live "Charges so far" hides the tradie's logged expense** ($165 client vs $211
   tradie); the $46 materials line only appears at invoice time, undercutting the "no surprises" promise.

---

## Critical

_None._ No data loss, hard block, or money-loss on the happy path. The lifecycle completed end-to-end
to a terminal paid + mutually-reviewed state.

---

## High

### H1 — Invoice defaults to $0.00 tax on job-accrued billables (inconsistent with the accepted quote's 13%)
- **Route:** `/jobs/IxUmZzqSI5ptFAkNpR7i` → Work order → **Create invoice** (Finish-job wizard) →
  Review & send → sent invoice on the Invoice tab (both roles).
- **Repro:** Log a manual time entry, add an expense, get a flat-fee change order approved, then Create
  invoice and review.
- **Observed:** The tradesperson's invoice table exposes a per-line **Tax %** column and **all three
  lines read `0.0%`** (Labour $85, materials $46, change order $80). Summary: **Subtotal $211.00 · Tax
  $0.00 · Total $211.00**. The client-facing invoice + receipt show the same $0.00 tax. The **accepted
  quote for the same job applied 13%** ($320 → $41.60 tax → $361.60), so the invoice silently drops the
  tax the client had agreed to on the quote.
- **Why it happens:** the time / expense / change-order entry dialogs never offer a tax-rate field, so
  job-accrued billables default to 0.0%. The wizard note even says "Edit individual rates in the Invoice
  section after the client approves if anything needs adjusting" — i.e. the default invoice is tax-free
  and the tradesperson must remember to add rates per line post-approval.
- **Observed vs expected:** Expected the invoice to inherit the tradesperson's tax setting (or the
  quote's 13%) so a registered tradesperson collects tax by default. Observed a silent $0.00 default.
- **Impact:** money/compliance — easy to send a tax-free invoice without noticing; under-collection of
  GST/HST. Editable-later mitigates but the *default* is the risk. Also makes the "Line (incl. tax)"
  column header misleading (see L5).

---

## Medium

### M1 — Receipt OCR reports success ("Receipt read") on an entirely empty parse
- **Route:** Work order → Add expense → **Upload receipt — auto-fill with AI**.
- **Repro:** Upload any image as a receipt (the AI has no usable key / can't read it).
- **Observed:** `parseReceipt` returns **200** with body
  `{ok:true, aiParsed:true, vendor:null, totalCost:null, spentAtIso:null, category:null, suggestedDescription:null}`.
  The dialog then shows a green success alert **"Receipt read. Give the fields a once-over and save."**
  while every field is blank, and a **$0.00 "Unknown vendor"** expense draft appears in the list.
- **Observed vs expected:** an empty extraction (all fields null) should say "couldn't read anything
  from this image — enter the details manually," not frame it as a successful read. `aiParsed:true`
  drives the success copy even when zero fields came back.
- **Note:** this is *not* a hard error path — the callable succeeds and the draft is discarded cleanly on
  Cancel (no ghost expense persists). The finding is the false-positive UX, not a data bug.

### M2 — Client's live "Charges so far" omits the tradesperson's logged expense
- **Route:** `/jobs/IxUmZzqSI5ptFAkNpR7i?tab=workorder` (client vs tradie).
- **Observed:** after the tradie logged a $46 marked-up materials expense, the **tradie** work-order
  total read **$211.00** (Time $85 + Materials $46 + Change orders $80) with a full Expenses section;
  the **client** work-order total read **$165.00** (Time $85 + Change orders $80) with **no Expenses
  section at all**. The $46 line is invisible to the client until the invoice (where it does appear and
  is billed).
- **Observed vs expected:** the two parties' live running totals disagree by the expense amount. Time is
  promised to "rack up here in real time" and the client explicitly approves change orders live, so a
  client watching charges accrue is surprised when the invoice is $46 higher than the live total implied.
- **Impact:** trust/transparency, not money-loss (the $46 is correctly on the final invoice). Likely a
  deliberate "expenses surface only on the invoice" choice — worth confirming intent and, if kept,
  signposting it on the client's work order.

### M3 — No discoverable client-side dispute entry point from a paid/completed job
- **Route:** `/jobs/IxUmZzqSI5ptFAkNpR7i` (paid, Complete) — Brief and Invoice tabs.
- **Observed:** scanned the whole job detail for any "dispute / report a problem / report an issue /
  contact support" affordance — **none**. The only vaguely related control is a generic "Help" link.
  (Admin dispute routes exist per the runbook, so the feature exists; the *client's* way in doesn't.)
- **Observed vs expected:** a client who's unhappy after paying has no obvious way to raise a dispute
  from the job. During "Awaiting payment" there is a milder "Request changes" on the invoice, but nothing
  once paid.
- **Impact:** discoverability — a real client would resort to the Help Center / email rather than a
  tracked dispute. (Not processed — admin side is run D's scope.)

---

## Low

### L1 — Accepted quote's proposed start date isn't carried to the Schedule tab
- Quote said **"Projected start: Tue, Jul 14, 2026"**, but the tradie's Schedule tab opens on the
  **current** week (Jul 6–12) with no booked visit and no reference to the agreed date. The tradesperson
  has to re-find/re-book it manually.

### L2 — Stale notification for a withdrawn change order
- The tradie proposed an $808 change order, then withdrew it and re-sent a correct $80 one. The client's
  bell keeps a live **"New change order: … — $808.00. Open the job to approve or decline."** notification
  for the withdrawn one — tapping it would lead to nothing to approve. Withdrawal doesn't retract the
  notification.

### L3 — `MutualReviewCard` Vue warning: dropped `class` (styling may not apply)
- On the completed job, the console logs (repeatedly, once per render):
  `[Vue warn]: Extraneous non-props attributes (class) were passed to component but could not be
  automatically inherited because component renders fragment or text or teleport root nodes.` at
  `<MutualReviewCard>`. The component has a multi-root template, so a parent-passed `class` is silently
  dropped — intended styling on the review card may not be applied. Dev-only warning, but a real
  styling-inheritance bug.

### L4 — Receipt view is sparse
- `/invoices/:id/receipt` shows "Payment confirmed", invoice number, and Subtotal/Tax/Total only. No
  line items, no tradesperson identity, no payment date or method. Functional but thin for a receipt.

### L5 — "Line (incl. tax)" header is misleading when tax is $0
- The client-facing invoice/quote table header reads "Line (incl. tax)", but with H1's $0.00 tax the
  lines are effectively tax-exclusive. Downstream of H1; resolves if tax defaults correctly.

---

## Positive confirmations (verified working — not bugs)

- **Uninsured waiver (client, accepting an uninsured tradesperson):** clear, well-worded legal copy;
  dual gate (acknowledgement checkbox **and** signature) with "Confirm & accept" disabled until both;
  total ($361.60) shown. Understandable at 375px. `acceptApplicationQuote` → 200; post converted to job.
- **Uninsured waiver (tradesperson, starting uninsured work):** thorough 4-point liability release,
  Foxquilt "Get insured" link, checkbox + signature, "kept on file for this job" note. Bilateral coverage.
- **Change-order lifecycle:** propose → client banner + inline Approve/Decline (+ correct bell copy) →
  approve (`respondExtra` 200) → "Approved" + charges update. One-tap approve has no confirm dialog, but
  the exact amount/description is on the card, so acceptable (unlike a bulk action).
- **AI gating:** clicking an AI quick-prompt as a non-Pro tradesperson raises the **Pro paywall**
  ("Unlock the full toolkit… 30-day free trial then $290 CAD/yr"), gracefully catching the `aiChat` 400
  (BLUESEAL_PRO_REQUIRED) — not a raw error.
- **Invoice build wizard:** 4 steps (Time / Expenses / Extras & charges / Discount & note), quote-line
  offered as optional add, live preview matches the sent invoice, no 375px overflow.
- **Offline payment = two-party confirm:** client "I've sent $211" (`clientMarkPaid` 200) → tradie
  "Mark as paid" with its own confirm dialog (`clientApproveJob`/mark-paid) → invoice **paid**, job
  **Complete**, receipt issued. Good anti-fraud sequencing.
- **Blind mutual reviews:** each side rates overall + categories (client→tradie: Quality/Punctuality/
  Communication/Value; tradie→client: Punctuality/Communication/Clarity/Payment). Held "hidden until they
  review you back"; once both submit, **both reveal** with correct attribution ("QA Tradie" + "You").
- **No horizontal overflow at 375px** on the compare-applications quote sheet, invoice preview, and the
  client/tradie invoice tables (all `scrollWidth === clientWidth`).

---

## Untested / blocked

- **Stripe CARD payment path + missing-webhook limbo state — BLOCKED, could not test.** The invoice
  offered **only** the offline "I've paid the tradesperson" path — no card/Stripe option anywhere
  (`mentionsCard:false`). The offline dialog itself notes "The tradesperson hasn't set up payment
  instructions yet." Almost certainly because **qa-tradie never completed Stripe Connect payout
  onboarding** (dashboard shows "Finish payout setup"); card money can't route to an un-onboarded payee.
  The task's Stripe test-card / limbo scenario is therefore untestable in this account state. To test it,
  a future run needs a tradesperson who has completed Connect onboarding.
- **Site-visit propose/respond** (P6) — not exercised (time).
- **"Draft with AI" invoice note** — not clicked (would paywall like the assistant).
- **View PDF** (invoice) — not opened.

---

## Acceptance checklist for this audit

- [x] Compare-applications UX + full quote reviewed at 375px (readable, no overflow, tax/total correct).
- [x] Uninsured waiver gate exercised and judged (clear; dual checkbox+signature gate).
- [x] Quote accepted → post converted to job → client landed on job detail.
- [x] Tradesperson-side uninsured waiver exercised.
- [x] Change order proposed → client approved → landed in work order; bell copy correct both ways.
- [x] Manual time entry logged (rate confirmed $85/hr); expense added with 15% markup ($40→$46).
- [x] Receipt-OCR upload path exercised; failure/empty UX judged (M1).
- [x] AI assistant gating confirmed (Pro paywall).
- [x] Chat exercised both directions; notification types verified (no invoice-masquerade).
- [x] Invoice built from billables; math verified line-by-line ($211 subtotal); tax discrepancy flagged (H1).
- [x] Payment completed via OFFLINE path to terminal **paid**; card path found unavailable (blocked).
- [x] Receipt view noted.
- [x] Blind mutual reviews submitted both directions; reveal mechanics verified.
- [x] Dispute entry-point discoverability checked from the paid job (M3).
- [x] Horizontal-overflow checked at 375px on quote sheet, invoice preview, invoice tables.
- [ ] Stripe card/limbo, site-visit, Draft-with-AI, View PDF — untested/blocked (see above).
- [x] Ended signed out at localhost:5173.
