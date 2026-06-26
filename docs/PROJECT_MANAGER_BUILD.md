# Project Manager build — status + handoff

> Working reference for the **Project Manager** feature (real estate agents,
> property managers, landlords). Read this first when resuming the build. The
> exhaustive design lives in the plan file
> `C:\Users\Johnny\.claude\plans\ok-so-we-have-valiant-kazoo.md`; this doc is the
> current status, the next task in detail, and the working agreements. Modeled on
> `docs/SALES_REPS_BUILD.md`.

## What this feature is

A **Project Manager** (`projectManager` role) is a client who switches on (or picks at
signup) a power mode to recommend trades, set up work for clients across properties, and
earn a referral commission. It is our two-sided acquisition channel: agents/PMs/landlords
bring their trusted trades onto Blue Seal (supply), and every client they email a job to
becomes a Blue Seal client (demand).

Noun hierarchy: a **Property** (address) holds **Projects** (a bundle of work for a client)
which hold **Jobs** (individual trade tasks).

## Locked decisions (see plan file for the full rationale)

| Area | Decision |
| --- | --- |
| Role | `projectManager`, a view-mode role layered on `client` (`["client","projectManager"]`). Self-serve, no vetting. |
| Onboarding | Two doors: a 3rd signup card AND a `/welcome` upgrade. Agreement e-signed at **payout setup**, not before the cockpit. |
| Saved/preferred trades | Reuse the existing `savedTradies` shortlist (NOT a new collection). For a PM it's their preferred contractors. |
| Recruiting | `/join?pm=CODE` + `pmReferralCodes` registry + `claimPmCode`. Signup auto-adds the recruit to the PM's savedTradies + grants the same free Pro month a rep code does (at go-live). Kept separate from the rep `?ref=` path. |
| Commission | Additive: on a PM-driven job, BOTH the tradesperson's sales rep (if any) AND the PM earn 10% of Blue Seal's service fee. Generalize the shipped commission engine; job fees only; platform-funded. |
| "PM-driven" | A job where one of the PM's PREFERRED contractors does work the PM ORIGINATED (a project, or a request off the PM's public profile). A public-fallback win by an off-list contractor is NOT PM-driven. |
| Dispatch | Compare-and-choose: client accepts a project, each job goes to ALL the PM's preferred contractors matching that trade for quotes, client picks; public-board fallback. |
| Visibility | PM sees the incoming quotes (amounts) while brokering, then a read-only status + schedule view; NO chat, NO live invoice. Other jobs by their contractors = aggregate count only. |
| Properties | PM-owned `properties/{id}` (mirror `clients/`). Connecting a client is a lightweight link (their own login sees that property's jobs; no impersonation). Optional; one connected client per property. |
| Public featuring | A PM may feature any preferred contractor on their public profile; the contractor is notified and can opt out (P5). |
| Monetization | Role + earning free. Managing MULTIPLE properties is the future paid tier (P6): build the meter behind the entitlements seam, leave open at launch. |

## Shipped (committed + pushed to `main`, live via CI)

| Commit | Milestone |
| --- | --- |
| `81946d9` | **P1** role + self-serve enable (signup card + `/welcome`) + agreement module + `requirePmActive` + `/manage` cockpit shell + role-switcher integration + `users.projectManager` rules + tests |
| `b0cf6d0` | **P2a** saved-trades re-hire list (reuses `savedTradies`) in the client dashboard + cockpit |
| `fe260df` | **P2b** recruiting link `/join?pm=` + `pmReferralCodes` + `claimPmCode` + provisionAccount auto-add + free month at go-live (`maybeMarkVisible`) + rules/tests |
| `83f7a8d` | **P3a** properties book: `properties/{id}` + rules (mirror `clients/`) + service + Zod + `PropertiesPanel` cockpit section + rules tests |
| `37db6cc` | **P3a** QA happy paths (section 13) |

Note: the role switcher is now driven by `src/data/roleViews.ts` (commit `cf1f711`, another session) — the single source of truth for role label/icon; it already includes `projectManager`. Don't reintroduce inline role maps.

Test counts after P3a: 450 app unit + 499 rules + 151 functions, all green.

Key data already in place: `Role` += `projectManager`; `users/{uid}.projectManager` (ProjectManagerState: active, referralCode, liability, payouts); `users/{uid}.referredByPmId`; `pmReferralCodes/{codeLower}`; `properties/{propertyId}` (PropertyDoc). Functions: `claimPmCode`, `provisionAccount` (pmCode), `maybeMarkVisible` (PM free month). Lib: `functions/src/lib/projectManager.ts` (`requirePmActive`, `assertPmAgreementSigned`, `initialProjectManagerState`, `resolvePmId`), `src/projectManager/agreement.ts`. Cockpit: `src/views/manage/ProjectManagerDashboardView.vue` (recruit + saved trades + properties sections).

---

## NEXT TASK — P3b: Projects + compare-and-choose dispatch

**The biggest, most sensitive phase. It edits the LIVE, payment-adjacent job-board engine. Build carefully, add composite indexes, test the rules, and verify on real Firestore against the Stripe test path before trusting it.**

### The flow
1. PM creates a **Project** (label, optional `propertyId`, a list of job specs `{trade, title, description}`) for a client by email.
2. Client gets a magic-link invite, account is auto-created, claims the project, becomes its `clientId`, and **accepts** it.
3. On accept, each job becomes a quote request **scoped to the PM's preferred contractors** matching that trade.
4. Preferred contractors quote (existing `submitApplication`); client picks via the existing `acceptApplicationQuote` -> a real `jobs/{id}` is created.
5. **Public fallback:** if no preferred contractor bids, the client opens it to the public board.
6. The won job is stamped `drivenByProjectManagerId` (only when the winner is a preferred contractor) + `projectId` + `propertyId`.

### KEY technical decision (do NOT skip)
Scoping a posting can't be a read-rule change alone — Firestore rules are not filters, so the public geohash feed query would break on posts it can't read (see memory `project_firestore_list_rule_pattern`). **Use a distinct `"invited"` JobPostStatus** (not `"open"`) plus an `invitedContractorIds: string[]` array:
- Public feed already queries `status == "open"` -> untouched, **no backfill** needed.
- Invited contractors get a dedicated query: `status == "invited" && invitedContractorIds array-contains me` (new composite index).
- Public fallback = flip `invited -> open` + clear `invitedContractorIds`.
- Read rule: owner/admin OR (`open` && visible tradie) OR (`invited` && uid in `invitedContractorIds`).

### Suggested decomposition (each its own commit)
- **P3b-1** `projects/{projectId}` collection + `createProject` callable + magic-link project invite + claim + accept. Mirror `createInviteJob`/`claimJobInvite`/`sendJobInviteSignInLink` (an invite that claims a BUNDLE under one email). PM cockpit "Projects" section + client accept UI. Touches no live job-board code.
- **P3b-2** the `"invited"` status + `invitedContractorIds` on `JobPostDoc` + `createJobPost` support + the read rule + the invited-contractor query/surface + composite index. On project accept, create one scoped posting per job (tagged `projectId`, `createdByProjectManagerId`). Extend `acceptApplicationQuote` to stamp `drivenByProjectManagerId`/`projectId`/`propertyId`. Public fallback.
- **P3b-3** PM read-only visibility: a projected status/schedule view of project jobs (no chat, no invoice) + aggregate counts for non-driven jobs.

### Reuse map (file pointers, verify before editing)
- Clients CRM (already mirrored as `properties/`): `clients/` rules `firestore.rules` ~503; `clientsService.ts`.
- Job board: `JobPostDoc`/`ApplicationDoc` in `interfaces.ts` (~1544/~1642); `src/firebase/services/jobPosts.ts` (`subscribeJobPostFeed`), `applications.ts` (`submitApplication`, `acceptApplicationQuote`); `functions/src/jobPosts/acceptApplicationQuote.ts` (creates the job — add the stamps here); jobPost rules `firestore.rules` ~861-934.
- Magic-link invite: `functions/src/jobs/createInviteJob.ts`, `claimJobInvite.ts`, `sendJobInviteSignInLink.ts`; `ClientInvite` in `interfaces.ts` (~1087).
- Job origin: `JobDoc` (~1145), `originType` (~1276), `JobStatus`/`JobPostStatus` enums.

### Verify (real Firestore + Stripe test mode)
Seed disposable `verify-*-claude` data: a PM with preferred contractors, a project, a client. Invite -> claim -> accept -> contractors quote -> client picks -> confirm the job carries `projectId` + `drivenByProjectManagerId` and the public feed is unaffected. Card-pay the invoice and confirm commission accrues to BOTH the rep (if any) and the PM (P4 territory). Clean up after.

---

## After P3b
- **P4 — commission:** generalize the shipped engine (`functions/src/lib/commissionAccrual.ts`, `commissionOwner.ts`, `scheduledRepCommissionPayouts.ts`, `CommissionDoc`) with an `ownerType` discriminator; ADD a PM accrual on `drivenByProjectManagerId` service-fee events (owner-scoped deterministic id so rep + PM entries coexist); generalize the payout scheduler + Connect onboarding for PMs. See plan file P4.
- **P5 — public PM profile:** mirror `TradieProfileView` + slug (`/pm/:slug`), instant/no vetting, featured trades + contractor opt-out.
- **P6 — multi-property paywall meter:** `requireMultiplePropertiesEntitlement` via the entitlements seam, open at launch.

## Working agreements (follow these)
- Read `CLAUDE.md` first. One increment at a time, fully shipped before the next.
- Gates green before any commit: `npm run build` + `npm run lint` + `npm run test:run` + `npm run test:rules` + `npm run functions:build` (+ `npm --prefix functions test` when functions change).
- **Deploy is CI on push.** A local `firebase deploy --only functions` is IAM-blocked for this account. Pushing `main` runs `.github/workflows/deploy.yml` -> deploys rules -> functions -> hosting atomically. So: commit locally; Johnny pushes (confirm before pushing).
- **Parallel sessions share the git index.** Re-check `git status` before staging; commit with an explicit pathspec — `git add <paths> && git commit -F - -- <paths>` — so another session's staged files can't ride along; verify with `git show --stat HEAD`. (See memory `feedback_parallel_sessions_git`.)
- Commit format: `Project Manager (Pn): short description`, ending with the `Co-Authored-By: Claude Opus 4.8` trailer.
- Per feature, update `docs/QA_HAPPY_PATHS.md` (section 13) and `src/data/help.ts` when users can see/do something new.
- **No em dashes** in user-facing copy.
