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
| `10400d8` | **P3b-1** `projects/{id}` + magic-link invite/claim/accept (`createProject`, `sendProjectInviteSignInLink`, `claimProjectInvite`, `respondToProject`, `unsubscribeProjectInvite`) + `ProjectsPanel` + `ClientProjectsPanel` + claim views + rules/tests |
| `73416f4` | **P3b-2a** scoped dispatch: `"invited"` JobPostStatus + `invitedContractorIds` + `dispatchScopedPostings` on accept; `submitApplication`/`acceptApplicationQuote` accept invited posts + stamp `drivenByProjectManagerId`/`projectId`/`propertyId`; "Invited to quote" surface + composite index |
| `f9721e6` | **P3b-2b** public-board fallback (`openPostingToPublic`: geocode + flip `invited`→`open`, clear scope) |
| `57734e9` | **P3b-3** PM read-only visibility: `ProjectDetailView` (posting status + quote amounts + won-job status/schedule); jobPosts/applications/jobs read rules widened to the PM; no chat/invoice |
| `3b233d5` | **P4a** additive PM commission accrual + reversal (owner-scoped id `..._pm_<pmId>`; rep path byte-for-byte unchanged); `accruePmServiceFee`/`reversePmServiceFee` at the paymentIntent + chargeRefunded/chargeDispute sites; commissions read rule widened to the PM |
| `fba98db` | **P4b-1** monthly payout scheduler generalized to pay PMs (group by `(ownerType, ownerId)`, read `projectManager.payouts`) |
| `2fd2bb0` | **P4b-2** `signPmAgreement` + PM Stripe Connect onboarding callables + `account.updated` PM routing |
| `87636fb` | **P4b-3** cockpit Earnings UI: `PmEarningsPanel` + `PmAgreementDialog` + `usePmEarnings` + `pmPayoutsService` |
| `9c009f3` | **P5a** public PM profile: `projectManagers/{uid}` doc + `claimPmProfileSlug` (+ `pmProfileSlugs` registry) + cockpit `PmProfilePanel` editor + public `ProjectManagerProfileView` (`/pm/:slug` + `/project-managers/:uid`) + rules/storage/tests |
| `b41c512` | **P5b backend** featured-contractor consent: `featuredContractors[]` on the public doc + `setFeaturedContractor` / `setPmFeatureOptOut` callables + `featuredByPms` / `pmFeatureOptOuts` subcollections + `pm_featured` notification + rules/tests. **UI still pending** (see below). |
| `1733382` | **UX A** real PM navigation (`useNavItems` projectManager case — was falling through to the CLIENT nav) + dedicated section routes under `/manage` + `/manage` rebuilt as a Dashboard overview + section views (Properties / Jobs / Trades / Earnings / Profile) reusing existing panels |

Note: the role switcher is now driven by `src/data/roleViews.ts` (commit `cf1f711`, another session) — the single source of truth for role label/icon; it already includes `projectManager`. Don't reintroduce inline role maps.

Test counts after P5a: 450 app unit + 527 rules + 171 functions, all green.

Key data added in P3b: `projects/{projectId}` (ProjectDoc + ProjectInvite + ProjectJobSpec, server-managed); `JobPostStatus += "invited"`; `JobPostDoc.invitedContractorIds`/`createdByProjectManagerId`/`projectId`/`propertyId`; `JobPostMetaDoc.preferredContractorIds`; `JobDoc.drivenByProjectManagerId`/`projectId`/`propertyId` + `originType "pm_project"`; `AddressPrivate.geo` nullable. The jobs-update rule's server-field pins were hoisted under one `isAdmin()` (distributive equivalence) to stay under Firestore's 1000-expression-per-request limit — keep that shape if you add more pins.

Key data already in place: `Role` += `projectManager`; `users/{uid}.projectManager` (ProjectManagerState: active, referralCode, liability, payouts); `users/{uid}.referredByPmId`; `pmReferralCodes/{codeLower}`; `properties/{propertyId}` (PropertyDoc). Functions: `claimPmCode`, `provisionAccount` (pmCode), `maybeMarkVisible` (PM free month). Lib: `functions/src/lib/projectManager.ts` (`requirePmActive`, `assertPmAgreementSigned`, `initialProjectManagerState`, `resolvePmId`), `src/projectManager/agreement.ts`. Cockpit: `src/views/manage/ProjectManagerDashboardView.vue` (recruit + saved trades + properties sections).

---

## P3b — Projects + compare-and-choose dispatch — SHIPPED ✅ (commits above)

The full flow is live: a PM creates a **Project** (label, optional `propertyId`, job
specs) for a client by email -> client claims via magic link (account auto-created,
becomes `clientId`) and **accepts** (confirming a structured job address) -> each job
fans out as a **scoped `"invited"` posting** to the PM's preferred contractors matching
that trade -> they quote (`submitApplication`), the client picks
(`acceptApplicationQuote`) -> the won `jobs/{id}` is stamped `projectId` + `propertyId`
+ `drivenByProjectManagerId` (only when the winner is a preferred contractor) -> public
fallback (`openPostingToPublic`) when nobody bids -> the PM gets a read-only
status/schedule + quote-amounts view (no chat, no invoice).

The KEY decision held: a distinct `"invited"` JobPostStatus (not `"open"`) keeps the
public geohash feed untouched (no backfill); invited contractors query
`status == "invited" && invitedContractorIds array-contains me`; the public fallback
flips `invited -> open` and clears the scope. `meta.preferredContractorIds` (never
cleared) drives the PM-driven commission decision so a preferred contractor who wins
even after a fallback still counts.

**Address decision (Johnny):** the client confirms the structured address at accept
(not the property, not the PM). No geocode until the public fallback, which geocodes
client-side (Google Maps) — invited postings are found by array-contains, not proximity.

---

## P4 — Commission + payouts for PM-driven jobs — SHIPPED ✅ (commits above)

A **PM-driven** job (carrying `drivenByProjectManagerId`) now accrues a SECOND 10%
service-fee commission to the PM, **additive** to the rep accrual — both ride the same
fee via an owner-scoped ledger id (`service_fee_<inv>_pm_<pmId>`); the rep path is
byte-for-byte unchanged. PM entries: `ownerType "pm"`, `ownerId = pmId`, `repId null`,
`ownerKind "pm_project"`. The monthly scheduler pays PMs the same way as reps (group
by `(ownerType, ownerId)`, read `projectManager.payouts`, $50 min, claim-before-pay).
The PM signs the agreement + onboards Stripe Connect from the cockpit **Earnings**
section. Refund / lost dispute reverses both rep + PM entries. An off-list
public-fallback win earns no PM commission (not PM-driven). Subscription fees: rep only.

Reuse map (for P5+ or debugging): `commissionAccrual.ts` (`accruePmCommission`/
`reversePmCommission`), `pmCommission.ts` (`accruePmServiceFee`/`reversePmServiceFee`,
called at `paymentIntent`/`chargeRefunded`/`chargeDispute`), `scheduledRepCommissionPayouts.ts`
(now owner-generic), `createPmConnect*` + `signPmAgreement`, `accountUpdated.ts` (pmId
routing), `pmPayoutsService.ts` + `usePmEarnings` + `PmEarningsPanel`/`PmAgreementDialog`.

## P5a — public PM profile — SHIPPED ✅ (commit above)

A PM publishes a brand + bio page at `/pm/<slug>` (free, instant, PM-controlled
`isVisible` toggle — no vetting). `projectManagers/{uid}` is world-read when published;
slug claimed via `claimPmProfileSlug` into the SEPARATE `pmProfileSlugs` registry
(so PM + tradesperson handles never collide). Cockpit `PmProfilePanel` edits it;
public `ProjectManagerProfileView` renders it.

### Still NOT verified on real Firestore (P3b + P4 + P5a)
Everything ships gates-green but **has not been exercised end-to-end on real Firestore +
the Stripe test path** (per `feedback_verify_real_firestore` — the site has no live
users). The right time is now that P4 is in (commission is only observable once a fee is
paid). Seed disposable `verify-*-claude` data (a PM with preferred contractors + a signed
agreement + Connect, a project, a client), run invite -> claim -> accept -> quote -> pick,
confirm the won job carries `projectId` + `drivenByProjectManagerId` and the public feed
is unaffected, then **card-pay the invoice** and confirm TWO commission entries (rep + PM,
distinct ids, 10% each), a refund reverses both, and the PM never reads the chat/invoice.
Also sanity-check `/pm/<slug>` publishes/hides correctly. Requires the latest push to be
CI-deployed first.

---

## NEXT TASK — PM experience redesign (UX B + C) + P5b UI

Johnny's direction (2026-06-25): the PM needs a "feature-ready tool", not the client
shell. **UX A shipped** (`1733382`): PM nav + dashboard + dedicated section routes.
Approved IA + a faithful clickable mockup live at **`c:\tmp\pm-dashboard-preview.html`**
(open it to see the target). Remaining:

### UX B — Property -> Projects -> Jobs drill-down (the noun hierarchy)
Right now `/manage/properties` shows PropertiesPanel + ProjectsPanel flat (interim).
Make it a hierarchy, since "projects live within each property":
- `PmPropertyDetailView` at `/manage/properties/:propertyId`: property header + the
  projects AT that property (filter `subscribeProjectsForPm` by `propertyId`) + a
  "New project here" that creates a project with `propertyId` prefilled. Each project
  card -> `/manage/projects/:id` (the existing read-only `ProjectDetailView`).
- Make PropertiesPanel cards link into the detail; move project creation out of the flat
  `ProjectsPanel` into the property-scoped flow (then retire/repurpose `ProjectsPanel`).
- Breadcrumbs: Properties / <address> / <project>.

### UX C — Trades hub directory search + P5b featuring UI
- Trades hub (`/manage/trades`): add a tradesperson DIRECTORY SEARCH so the PM can find
  + Save trades to refer (reuse the client `/search` save flow — but confirm the route
  guard lets a projectManager activeRole reach it, or embed the search component
  directly rather than routing to `/search`). The recruit link + saved list are already
  there.
- **P5b featuring UI (backend already shipped, `b41c512`):** a featured-toggle per saved
  trade on the Public-profile section (calls `setFeaturedContractor`), render
  `featuredContractors` on the public `ProjectManagerProfileView` as cards ->
  `/request/:tradieId`, and a contractor-facing **`/featured-by-pms`** view listing
  `users/{uid}/featuredByPms` with a Remove (opt-out -> `setPmFeatureOptOut`) action.
  Client wrappers for `setFeaturedContractor` / `setPmFeatureOptOut` /
  `subscribeFeaturedByPms` still need adding to a service. **IMPORTANT:** the
  `pm_featured` notification already links to `/featured-by-pms` — that route/view MUST
  exist before any featuring UI is exposed (today nothing can feature, so no notification
  fires — safe — but don't ship the featuring toggle without the opt-out view).
- **Request attribution (optional):** `JobDoc.requestedViaPmId` + `?via=<pmId>` on the
  profile's request links + `createJob` stamp + jobs-rule pin.

Each increment: Help/FAQ + QA section 13 + gates green.

## After the redesign
- **P6 — multi-property paywall meter:** `requireMultiplePropertiesEntitlement` via the entitlements seam, open at launch.

## Still NOT verified on real Firestore
P3b + P4 + P5 ship gates-green but the end-to-end money path (card-pay -> rep + PM
commission -> refund reverses both) + the public profile publish/hide have NOT been
exercised on real Firestore + Stripe test. See the verify script above; do it once the
latest push is CI-deployed.

## Working agreements (follow these)
- Read `CLAUDE.md` first. One increment at a time, fully shipped before the next.
- Gates green before any commit: `npm run build` + `npm run lint` + `npm run test:run` + `npm run test:rules` + `npm run functions:build` (+ `npm --prefix functions test` when functions change).
- **Deploy is CI on push.** A local `firebase deploy --only functions` is IAM-blocked for this account. Pushing `main` runs `.github/workflows/deploy.yml` -> deploys rules -> functions -> hosting atomically. So: commit locally; Johnny pushes (confirm before pushing).
- **Parallel sessions share the git index.** Re-check `git status` before staging; commit with an explicit pathspec — `git add <paths> && git commit -F - -- <paths>` — so another session's staged files can't ride along; verify with `git show --stat HEAD`. (See memory `feedback_parallel_sessions_git`.)
- Commit format: `Project Manager (Pn): short description`, ending with the `Co-Authored-By: Claude Opus 4.8` trailer.
- Per feature, update `docs/QA_HAPPY_PATHS.md` (section 13) and `src/data/help.ts` when users can see/do something new.
- **No em dashes** in user-facing copy.
