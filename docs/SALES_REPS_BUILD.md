# Sales reps build — status + handoff

> Working reference for the regional + referral **sales rep** feature. Read this
> first when resuming the build. The exhaustive design lives in the plan file
> `C:\Users\Johnny\.claude\plans\can-you-help-me-sparkling-treehouse.md`; this doc
> is the current status, the next task in detail, and the working agreements.

## What this feature is

Two coexisting sales models under one `sales` role:

- **Regional managers** own a territory (a set of postal **FSA** prefixes) and earn on it.
- **Referral salespeople** get a personal vanity **code/link** and own the specific tradespeople who sign up through it.

**Unified ownership rule (the heart):** every rep gets a code; a rep may also own region(s).
A tradesperson's **owner** = the rep whose code/link they used at signup (`referredByRepId`),
**else** their region's current rep, **else** nobody. **Referral beats region.** A deactivated
referral rep falls back to the region's rep.

- **Commission:** a flat **10%** of all Blue Seal revenue an owned tradesperson generates
  (Pro subscription + the platform portion of the per-job service fee), **life of the tradesperson**.
- **Incentive:** signing up with any active rep's code grants the tradesperson **1 month free Pro,
  no card**, starting at go-live (reuses `subscription.proCompUntil`). Direct signups keep the card trial.
- **Liability gate:** a rep is inert (no code, no vetting) until they e-sign the liability agreement.
- **Payouts:** reps are paid 10% via **monthly Stripe Connect transfers** to their own account (M6).

## Locked decisions

| Area | Decision |
| --- | --- |
| Rate | 10% (`COMMISSION_RATE_BPS = 1000`) on subscription + service-fee platform portion |
| Residual | Life of the tradesperson, while the owning rep is active |
| Ownership | `referredByRepId` (frozen at signup) beats region; deactivated rep falls back to region |
| Regions | Named FSA-prefix territories; tradie auto-assigned by their postal code at submit |
| Referral capture | Link `/join?ref=CODE` or typed vanity code → resolved to an active+signed rep. (Name picker dropped: enumeration surface.) |
| Liability | All reps e-sign (versioned) on first login; blocks ALL rep function until signed; placeholder copy in `src/sales/agreement.ts`, replace before launch |
| Vetting authority | Owner vets their tradies (full approve/reject) with audit; admin always overrides |
| Free month | At go-live, no card, no auto-charge after, no cap |

## Shipped (deployed to prod + committed to `main`)

| Commit | Milestone |
| --- | --- |
| `9e3d817` | **M1** sales role + regions (FSA territories) + admin region CRUD |
| `591db42` | **M2** rep identity: vanity codes + liability sign-off gate |
| `70b1e37` | **M3** referral capture at signup (link + code) + free month at go-live |
| `51773fd` | **M4a** region auto-assignment by FSA (captured from the map pin) + attribution mirror |
| `0bd2aad` | **M4b** server-side scoped vetting (ownership-gated decision callables + rep read callables) |
| `61c0011` | **M4c** rep vetting UI under `/sales` (queue + review with signed doc links + decisions) |
| `1c0333d` | **M5a** commission ledger model + 10% math + rules (no accrual yet) |
| `836c4d1` | **M5b** commission accrual + reversal wired into the live Stripe webhooks |
| `c6cc3c8` | **M6** rep Stripe Connect onboarding + monthly commission payout scheduler |
| `ef211e6` | **M7a** rep dashboard: earnings, payouts, Connect onboarding UI |
| `972407e` | **M7b** scheduledRegionHealth: daily active-tradie recount + budget unlock |
| `e12c411` | **M7c** admin reps console + pending-payout reconciliation |
| `261096b` | **M8a/b** rep resource hub + tradesperson's rep-contact card |
| `aecaca6` | **M8c/d** pitch slide + Help/FAQ + QA happy-paths sweep |

**Feature complete.** Test suite: **447 unit + 482 rules + 151 functions, all green.** Live functions
include `adminUpsertRegion`, `adminDeleteRegion`, `signSalesAgreement`, `claimReferralCode`,
`submitForVetting` (region stamp), `provisionAccount` (referral capture), `maybeMarkVisible` path
(free month), the vetting decision callables (rep-scoped), `listRepApplications`,
`getApplicationDetails`. `stripeWebhook` accrues + reverses commissions (M5b). M6 added
`createRepConnect{Account,OnboardingLink,LoginLink}`, the `account.updated` rep-payouts mirror, and
the monthly `scheduledRepCommissionPayouts`. M7 added `scheduledRegionHealth`, `adminListSalesReps`,
`adminSetRepActive`, `adminRetryPayoutBatch`, and the rep dashboard / admin console UI. M8 added
`getMyRepContact`, the `/sales/resources` playbook, and the tradesperson rep-contact card.

**Not yet live to users:** the M7/M8 client (Vue) is committed but the hosting bundle hasn't been
deployed (`npm run deploy:prod`) or pushed. All Cloud Functions ARE deployed + verified ACTIVE.

Key data already in place: `users/{uid}.salesRep` (code + liability + active), `users/{uid}.referredByRepId`,
`regions/{id}` (fsaPrefixes + repId), `referralCodes/{codeLower}`, `tradespeople/{uid}.{regionId,referredByRepId,referralSignal}`,
`tradespeople/{uid}/private/contact.postalCode`, and the empty `commissions` + `commissionPayouts` collections (rules live).

---

## M5b (SHIPPED — `836c4d1`): commission accrual on the live Stripe webhooks

Shipped + deployed (`functions:stripeWebhook` verified ACTIVE via gcloud before commit). The
blueprint below is kept as the reference for how accrual works. What landed:
`functions/src/lib/commissionOwner.ts` (`resolveCommissionOwner`) + `commissionAccrual.ts`
(`accrueCommission` / `reverseCommission`, deterministic ids so a webhook replay never doubles),
wired into `payment_intent.succeeded` (service fee), the new `invoice.payment_succeeded` handler
(subscription), and reversals on `charge.refunded` (full refund) + `charge.dispute.closed` (lost).
Partial-refund + subscription-chargeback proportional clawback are deliberately deferred (no
finalized policy — `PROFESSIONAL_TASKS.md`). 15 new unit tests; QA happy paths 11.9/11.10.
**Verified end-to-end on real Firestore** (test-mode Stripe, live webhook) via
`functions/scripts/verify-commission.mjs`: accrual (right rep, 10%, exactly one entry) + reversal
on a full refund, then cleaned up.

### Helpers to add
1. `functions/src/lib/commissionOwner.ts` → `resolveCommissionOwner(tradieUid)`:
   read `tradespeople/{uid}` for `referredByRepId` + `regionId`.
   - if `referredByRepId` set AND `users/{referredByRepId}.salesRep.active !== false` →
     `{ repId: referredByRepId, regionId, ownerKind: "referral" }`
   - else if `regionId` set → read `regions/{regionId}`; if it has a `repId` →
     `{ repId, regionId, ownerKind: "region" }`
   - else `null` (platform keeps 100%).
2. `functions/src/lib/commissionAccrual.ts` → `accrueCommission({ tradespersonId, source, sourceRef, grossCents })`:
   - resolve owner; if null or `commissionCents(grossCents) === 0`, return (no entry).
   - **Idempotency:** deterministic doc id `commissions/${source}_${sourceRef}` + `set(..., { merge: false })`,
     so a Stripe webhook **replay overwrites the same doc** (never double-accrues).
   - write `CommissionDoc` (see `interfaces.ts`): `{ repId, regionId, tradespersonId, ownerKind, source,
     sourceRef, grossRevenueCents, rateBps: COMMISSION_RATE_BPS, commissionCents, status: "accrued",
     payoutBatchId: null, reversalOf: null, createdAt }`. Use `commissionCents()` from `functions/src/lib/commission.ts`.

### Accrual points (find + wire)
- **Service fee:** the invoice `payment_intent.succeeded` handler (where the invoice is marked paid +
  tradie stats increment — near `functions/src/payments/handlers/` / `createInvoicePaymentIntent.ts`).
  Accrue `source: "service_fee"`, `sourceRef: invoiceId`, `grossCents: invoice.payment.serviceFee.platformPortionCents`.
  Pro tradies have the fee waived → platformPortionCents 0 → no accrual (correct).
- **Subscription:** `functions/src/payments/handlers/subscription.ts` on the Stripe `invoice.payment_succeeded`
  (subscription invoice) — may need to ADD handling for that event. Accrue `source: "subscription"`,
  `sourceRef: stripeInvoiceId`, `grossCents: amount_paid`. The free comp month has no Stripe invoice → no accrual (correct).

### Reversals
- On `charge.refunded` / invoice refund / subscription dispute: write a separate offsetting entry
  `status: "reversed"`, `reversalOf: <original commission id>` (don't mutate the original). Payout math (M6)
  nets accrued minus reversed.

### Verify (before trusting it)
Per the project's "verify on real Firestore" practice: seed disposable `verify-*-claude` data
(a rep, a referred tradie, a region), drive a test-mode Pro checkout + an invoice payment, confirm
exactly one `commissions` entry each with the right `repId` + 10% amount, replay the webhook and
confirm NO duplicate, then refund and confirm a `reversed` entry. Add functions/unit coverage where feasible.

---

## M6 (SHIPPED): rep Stripe Connect + monthly payouts

Shipped + deployed (5 functions verified ACTIVE via gcloud). Rep Connect onboarding mirrors the
tradie flow — `createRepConnect{Account,OnboardingLink,LoginLink}` write `users/{uid}.salesRep.payouts`
(transfers-only capability; `metadata.repId` round-trip), and `account.updated` mirrors that slice
with a payouts-only status derivation (a transfers-only rep reads "enabled", not "restricted"). The
monthly `scheduledRepCommissionPayouts` (1st @ 03:30 PT) nets each rep's `accrued` minus not-yet-netted
`reversed`, and when the net clears the **$50 min** transfers it to their Connect account, writing a
`commissionPayouts` batch and flipping the entries to `paid`. Money-safety: **claim-before-pay** (flip
to paid + write a `pending` batch BEFORE the transfer, idempotency-keyed transfer, then confirm), so a
retry/replay can never double-pay; transfer rejection unwinds the claim; below-min rolls over. Netting
math is a pure helper (`functions/src/lib/commissionPayout.ts`, 8 unit tests). Deferred: partial-refund
proportional clawback, post-final-payout clawback, and pending-batch reconciliation (M7 admin console).
**Verified end-to-end on real Firestore** (test-mode Stripe) via `functions/scripts/verify-payout.mjs`:
seeded a payout-enabled rep + $60 accrued, triggered the deployed scheduler, confirmed a real transfer,
a `paid` batch, and the ledger flipped to `paid`, then cleaned up.

## M7 + M8 (SHIPPED) — the feature is complete

- **M7a** `/sales` dashboard: earnings-at-a-glance + `/sales/payouts` (Stripe Connect onboarding,
  unpaid balance, payout history) + the missing `sales` nav branch.
- **M7b** `scheduledRegionHealth`: daily per-region active/total recount + marketing-budget unlock.
- **M7c** `/admin/sales-reps`: rep roster + earnings, activate/deactivate, pending-payout retry
  (idempotency-safe). Region rep assignment stays in `/admin/regions`.
- **M8a/b** `/sales/resources` playbook + the tradesperson "Your Blue Seal rep" contact card.
- **M8c/d** a "supply engine" pitch slide + a tradesperson FAQ + QA happy paths 11.11–11.14.

**Verified on real Firestore:** accrual + reversal (`verify-commission.mjs`) and the monthly payout
(`verify-payout.mjs`). The rep-facing UI is committed but not yet deployed to hosting.

### Open follow-ups (next session)
- **Deploy hosting + push** (`npm run deploy:prod`) to make the M7/M8 UI live — needs Johnny's go-ahead.
- Optional: a real-browser QA pass of the rep dashboard / admin console (qa-runner), and the deferred
  edges noted in M5b/M6 (partial-refund proportional clawback; post-final-payout clawback).

---

## Working agreements (follow these)

- **Read `CLAUDE.md` first.** One milestone at a time, fully shipped before the next.
- **Gates green before any deploy:** `npm run lint && npm run build && npm run test:run` + `npm run test:rules`
  + `npm run functions:build`.
- **Deploy Firebase changes BEFORE the commit that ships dependent code.** Deploy **targeted**
  (`firebase deploy --only firestore:rules` / `--only functions:<name>,<name>`) — full functions deploys
  hit the per-minute quota. Verify each function is `ACTIVE` with a fresh `updateTime` via
  `gcloud functions describe <name> --region us-central1 --gen2 --project blueseal-762af`, not the CLI exit code.
  Deploys are flaky (transient 503 / "internal error") — just retry.
- **Pause for review at each milestone:** finish + gate the milestone, summarize, and get Johnny's
  go-ahead before deploying + committing.
- **Commit straight to `main`** (auto, as gates pass). Confirm before pushing. Johnny runs **parallel
  sessions** — re-check `git status` before staging, stage **explicit paths** (never `git add -A`), and
  check for foreign hunks. Commit messages end with the `Co-Authored-By: Claude Opus 4.8` trailer.
- **Per feature, also update** `docs/QA_HAPPY_PATHS.md` (the `/qa` toolkit) and `src/data/help.ts`
  (Help/FAQ) when users can see/do something new.
- **No em dashes in user-facing copy** (Johnny reads them as an AI tell).
