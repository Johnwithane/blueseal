# Next session: continue Phase 3 (gap assessment 2026-07)

Paste the prompt below into a fresh session, or just point the session at this file.

Context: Phase 0 + Phase 1 are done; Phase 2 is 20/22 done (P2-03, P2-20 deferred);
Phase 3 is in progress (P3-04, P3-11, P3-12 shipped). This continues Phase 3.

---

```
Continue the Phase 3 work from the 2026-07 gap assessment.

READ FIRST (in order):
1. CLAUDE.md — how we build (per-feature loop, gates, deploy-before-commit discipline, commit conventions).
2. docs/GAP_ASSESSMENT_2026-07.md — the fix plan. Phase 0/1 done, Phase 2 done (20/22),
   Phase 3 in progress. The Phase 3 status block lists what's shipped vs open.
3. MONETIZATION.md §10b — the LOCKED money/vetting policy decisions for P3-02/P3-05/P3-08.
   These are Johnny's calls; implement to them exactly, don't re-litigate.

WHAT'S ALREADY SHIPPED IN PHASE 3 (don't redo): P3-04 (upfront-refund cap give-back),
P3-11 (quote status pinned in rules), P3-12 (roster-remove confirm).

DO THIS SESSION — Phase 3 remaining. Two groups:

A) Money-policy implementations (from MONETIZATION.md §10b — careful money code, write tests):
   - P3-02: accrue rep + PM commission on the UPFRONT fee's platform portion, mirroring the
     invoice path (functions/src/payments/handlers/paymentIntent.ts:231-265 vs upfrontFee.ts).
     Use a distinct sourceRef (e.g. `upfront_<jobId>`) so it coexists with the invoice entry,
     and REVERSE it on upfront refund (handleUpfrontRefund in chargeRefunded.ts). Note: the
     rep/PM accrual+reversal primitives (lib/commissionAccrual.ts, lib/pmCommission.ts) are
     keyed to invoiceId today — you'll need to generalize them to an arbitrary sourceRef.
   - P3-05: make commission reversal PROPORTIONAL for partial refunds (full refund still 100%).
     Generalize reverseCommission / reversePmCommission to reverse round(commissionCents ×
     proportion), keyed idempotently so repeated partial-refund webhook events don't double-reverse.
   - P3-08 + P3-07: reps are FULL vetters — port the admin trust tooling (insurance/WSIB cards,
     registry-verify helper, inline watermarked doc viewer) from ApplicationReviewView.vue to
     SalesApplicationReviewView.vue; and surface region + assigned-rep attribution + approvedBy
     in the admin vetting queue/header (VettingQueueView.vue, ApplicationReviewView.vue).

B) Concrete server/ops items (no decision needed):
   - P3-01: mirror the upfront-fee double-charge detection (upfrontFee.ts:102-116) into the
     invoice paymentIntent path (paymentIntent.ts:130-138) so an offline-mark + in-flight card
     race is logged for admin review, not a bare warn.
   - P3-03: monthly netting must include owners with unapplied reversed entries even if they
     stopped earning (scheduledRepCommissionPayouts.ts:105-116).
   - P3-06: admin support/bug/error queues silently truncate at 200 and can drop OPEN tickets —
     status-scoped query or pagination (support.ts:64, bugReports.ts:94, errorReporting.ts:83;
     copy AdminJobs' "showing most recent 300" pattern).
   - P3-09: render the rep per-tradesperson earnings breakdown (summary.byTradie exists in
     repEarnings.ts:58 but SalesRepPayoutsView.vue:82 only shows a count).
   - P3-10: tighten the jobPosts photo storage path (storage.rules:211-214).

WORKFLOW / CAUTIONS:
- Per CLAUDE.md: lint + build + test:run (and test:rules if rules change) must pass; deploy any
  functions/rules/indexes change TARGETED (firebase deploy --only functions:<name> / firestore:rules)
  BEFORE the commit that ships it. Commit straight to main, one logical change per commit; confirm
  before pushing.
- CONCURRENT SESSIONS run on this repo. Before staging: re-check `git status`, stage EXPLICIT paths
  (never `git add -A`), and check for foreign hunks. Full functions deploys hit the per-minute quota —
  always deploy targeted.
- Money code: extract pure helpers and unit-test them (see decideReclaim in stripeWebhook.ts and
  computeUpfrontCapGiveBack in chargeRefunded.ts for the pattern the FakeFirestore can't drive queries).
- When you finish an item: tick its box in docs/GAP_ASSESSMENT_2026-07.md with the commit hash,
  and update the Phase 3 status block.

Suggested order: A-then-B, doing P3-02+P3-05 together (they share the commission primitives), then
P3-08/P3-07 (UI, no deploy), then the B items. Start by reading the three files above and the
current commission accrual/reversal code, then give me a short plan before writing code.
```

---

After Phase 3, remaining phases: Phase 4 (consistency/a11y/PWA/copy — 10 items, incl. the em-dash
sweep and the currency-formatter unification) and Phase 5 (docs truth-up + the `.optional()`-without-
`.nullable()` lint rule P5-09). Also outstanding across earlier phases: a **375px browser re-verify
pass** for the P1/P2 UX items (the doc's acceptance rule), and **P2-20** (auth chrome flash) pairs
with P1-03's acceptance run.
