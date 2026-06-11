# QA Audit — Full-Platform Pass (2026-06-10)

**Method:** three parallel code audits (client flows / tradesperson flows + jobs engine / cross-cutting platform layers) produced ~85 candidate findings; every finding was then adversarially re-verified against the actual code before being acted on or reported. About a third of the raw candidates were refuted — they're listed in the appendix so future sessions don't re-chase them.

**Scope covered:** auth + signup (both roles), search/browse, job posting + intake, job board (applications, Q&A, referrals), direct requests, quoting (incl. site-visit-first + revisions), job pipeline (kanban, chat, clock in/out, extras/change orders, work order), invoicing + payments + payouts, reviews, notifications, Firestore/Storage rules, Cloud Functions, validation schemas, PWA/manifest/SW, help content, a11y spot-checks, test coverage.

---

## 1. Fixed in this pass

All deployed (rules + functions) before their commits, per deploy-before-commit discipline.

| Commit | Fix |
| --- | --- |
| `0f9c553` | **Referrals:** geohash cell-center slack excluded boundary tradies from the picker (search + radius filter now pad 1 km); load errors got a Try again button; notification title now leads with the job title so multiple referrals are scannable. |
| `f66944c` | **Jobs engine guards (server):** clock-in was only blocked on `cancelled` — now also blocked on `awaiting_payment` / `complete` / `reviewed` (time there could never be billed); hourly clock-in with a $0 profile rate is rejected with a pointer to the profile; `respondJobChange` re-checks eligibility at accept time so a cancel/postpone request can no longer regress a job that finished in the meantime. |
| `3e6286f` | **Expense rules:** string fields were unbounded and numerics weren't re-validated on update — shared `validExpenseFields()` now bounds both on create *and* update, with new allow/deny tests. |
| `7a40bc7` | **Google sign-in:** a brand-new user tapping "Continue with Google" on */sign-in* was silently provisioned as a **client** — new accounts now get a "hiring or working?" choice (tradesperson path reuses `addRole` → `/onboarding`). Existing accounts now honour `?redirect=`. |
| `cedec37` | **Request quote page:** tradie/intake load failures were unhandled (blank form, no error) — now loading row + human error + retry. |
| `15fc9a8` | **Post job:** photos don't survive the sign-in bounce (drafts persist text only) — users are now told before the redirect instead of losing photos silently. |
| `e988360` | **Invoices:** a fixed discount larger than the subtotal silently clamped to a $0 invoice — both entry points (InvoiceEditor, FinishJobSheet) now warn inline and block. |
| `8f2f638` | **PWA:** `/apple-touch-icon.png` 404'd (referenced by index.html + manifest includeAssets) — restored from the current-brand 180×180. |

| `4fc6a50` | **Job board:** `pendingApp` cleared after a successful accept-quote (state hygiene; committed separately once a concurrent session's staged work in the same file landed). |

---

## 2. Confirmed issues — backlog (ranked)

### Data-loss / money (do these first)

1. **Quote draft loss** — `src/components/QuoteSheet.vue` has no draft persistence; closing the dialog discards every line item (PostJobView already solved this pattern with a localStorage draft). *Fix: sessionStorage autosave keyed by job/post id, restore on reopen, clear on submit.*
2. **Intake brief draft loss** — `src/features/jobDetail/BriefTab.vue` is rendered with `v-if` per tab, so switching tabs destroys unsaved intake edits with no warning. *Fix: autosave the draft like PostJobView, or dirty-check before tab switch.*
3. **Upfront fee drift on quote resend** — `functions/src/jobs/submitQuote.ts` re-derives the fee from `bps × new subtotal`, so revising line items silently changes the dollar amount the client previously saw. *Fix: show the old → new fee delta in QuoteSheet on resend and make the tradie acknowledge it.*
4. **clockOut has no duration sanity bound** — `addManualTimeEntry` caps at 24 h; clockOut accepts a forgotten overnight session without comment. *Fix: UI warning above ~10 h elapsed ("log 16 h?"), keep the server permissive but flag long sessions on the entry.*

### Silent failures / UX correctness

5. **Notification preferences gaps** — `newJobPostingEnabled` defaults on with **no opt-out UI** (only email/WhatsApp toggles exist; relevant to CASL), and there's no per-channel granularity. `functions/src/lib/notify.ts:168`, `AccountView`.
6. **notify() fan-out failures are unreconstructable** — each channel logs independently with no shared correlation id or failure record; a broken WhatsApp integration would silently drop high-priority alerts. *Fix: add a correlation id to the three log lines or write a `failedNotifications` doc on channel failure.*
7. **Payouts return page re-toasts on every refresh** — `src/views/payouts/PayoutsOnboardingView.vue:23` has no freshness guard on the route watch.
8. **PostJobView intake validation is a generic message** — "Please answer: X" with no scroll-to/highlight of the offending field (`PostJobView.vue:291`).
9. **SearchView silent blank state** — when localStorage is unavailable and no location is seeded, auto-search never fires and nothing explains why (`SearchView.vue:68–85`). *Fix: fall back to a default metro or show a "pick a location" prompt state.*
10. **NotificationsPanel has no load-more** — fixed-height scroll only; older items are effectively unreachable.

### Polish / a11y / content

11. **Icon-only buttons missing `aria-label`** — ChatThread send + image upload buttons, notifications bell (`ChatThread.vue:395-396`, `shell/NotificationsButton.vue`). Quick wins.
12. **iOS touch icon is transparent** — iOS renders transparency as black; produce an opaque beige-background 180×180 (and consider a maskable icon for Android).
13. **Full postal code isn't normalized** — FSA is uppercased, the full code isn't (`schemas.ts` comment says "normalize before storing" but only FSA does). Display drifts between `k1a1a1` / `K1A 1A1`.
14. **Photo requirement asymmetry** — job posts require ≥1 photo for every trade; direct requests don't. Some trades (e.g. consultations) arguably shouldn't require photos.
15. **BrowseJobsView vetting message placement** — pending-vetting notice sits above disabled-looking filters; mildly confusing for a new tradie.
16. **Help content** — referrals are covered by an FAQ + a mention in "win work" (fine for now; add a dedicated article if usage grows). The Stripe payouts article doesn't set expectations (docs needed, 2–5 day onboarding, common hold-ups).

### Infra

17. **No client-side error monitoring** — no Sentry/equivalent, no `app.config.errorHandler`. Production client errors are invisible. *Smallest first step: a global error handler that logs to a Firestore `clientErrors` collection or Cloud Logging.*
18. **E2E coverage is 2 specs** (search prefill, SEO smoke). The money paths — sign-up → post → apply → accept → clock → invoice → pay — have zero end-to-end coverage. Highest-leverage quality investment available.
19. **Functions have no unit tests** (e.g. sendJobReferral's dedup/rate-limit/trade-match guards are pinned only by manual QA).

---

## 3. Marketplace-standard features we don't have (ranked roadmap)

Verified absent in code. Ranked by impact-for-effort for a trust-first trades marketplace; benchmarks named so the pattern is easy to study.

| # | Feature | Benchmark | Impact | Effort | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | **Job status timeline/stepper** on job detail | Uber trip tracker, Domino's | High | Low-Med | Clients constantly ask "what happens next?" — a 6-step visual (posted → quoted → accepted → in progress → invoiced → done) removes most of that. Pure UI over existing statuses. |
| 2 | **Saved / favourite tradespeople** | Airbnb wishlists | High | Med | `favourites: string[]` on the user doc + heart on TradieCard/profile + a "Saved" shelf on search. Directly drives repeat hires. |
| 3 | **Web push notifications (FCM)** | Every marketplace | High | Med-High | In-app + email/WhatsApp exist, but the PWA can't reach a closed tab. Biggest lever on quote-response latency, which is the marketplace's core loop. |
| 4 | **Quote templates** | Jobber, Joist | High (tradie retention) | Med | "Save as template / start from template" in QuoteSheet. Pairs naturally with fixing quote-draft loss (backlog #1). |
| 5 | **Post preview before publish** | TaskRabbit | Med | Low | Render the post exactly as tradies will see it (public fields only) before submit. |
| 6 | **Input masking** (postal `A1A 1A1`, phone `(613) 555-0199`) | table stakes | Med | Low | PrimeVue InputMask; pairs with postal normalization (backlog #13). |
| 7 | **Recently viewed tradespeople** | Airbnb/Amazon | Med | Low | localStorage list + carousel on search. |
| 8 | **Photos on quotes** | Jobber | Med | Low-Med | "Here's the fixture I'd install" — quotes are currently text-only. |
| 9 | **Cancellation policy surfacing** | Airbnb | Med (trust) | Low | One static modal linked from accept-quote; the change-request flow already implements the mechanics. |
| 10 | **Response-time / activity badges on applicants** | TaskRabbit, Care.com | Med | Med | "Usually responds in 2 h" needs response-time aggregation server-side. |
| 11 | **Mileage on expenses** | Jobber, ServiceTitan | Med | Med | Rural Canada reality; expenses already exist, add km × rate entry type. |
| 12 | **"On my way" + live ETA share** | Uber | High wow | High | Time-boxed location share link. Defer until mobile usage justifies it. |
| 13 | **Offline clock-in queue** | field-service apps | Med | High | IndexedDB queue + sync; real architectural work. Defer, but don't add features that make it harder. |

Not on the roadmap because they already exist (verified): review-prompt notification after payment, hourly rate on public profiles, service-area editor in Account, week+month calendar views, street-address masking until selection ("Exact address shared after selection").

---

## 4. Appendix — refuted findings (don't re-chase)

| Claim | Why it's wrong |
| --- | --- |
| clockOut rounding loses money | `clockOut.ts:51` computes float ms→hours×rate and rounds **once** at the end — exactly the correct pattern. |
| clockIn auto-stop same-millisecond race | All reads/writes are in one Firestore transaction; a concurrent clockIn retries against committed state. |
| JobDetailView un-awaited `loadJobDependents` causes stale UI | Fire-and-forget is deliberate; `finally` + `loading` gate the render and fallbacks cover missing deps. |
| InvoicePayView flashes "Not your invoice" after payment | Guards are synchronous over the subscribed doc; no window for a flash. |
| Post photos fail "broken-looking" | Failed downloads render as intentional blank placeholders (`v-if` per URL). Could be prettier, not broken. |
| Clock-out UI is optimistic and can desync | `TimeTrackerCard` disables the button during the call and toasts on error — no optimistic state. |
| SW serves a stale shell for 24–48 h after deploy | `registerType: "prompt"` + precache + hourly update check + `useAppUpdate` prompt is the correct, current setup. |
| No analytics at all | Firebase Analytics is initialized (`firebase/config.ts:54`). What's missing is *funnel instrumentation*, not the SDK. |
| Referral indexes don't match queries | Both composites match `referrals.ts` query shapes exactly. |
| Returning Google tradies land as clients | The hardcoded role only ever applied to brand-new accounts (now fixed with the role-choice dialog). |
| Currency formatting is ad-hoc | Centralized `Intl.NumberFormat("en-CA")` in `useFormatters`; the `.toFixed()` hits are ratings/distances. |
| Listener leaks in views | Spot-checked subscribers (JobDetailView, dashboards, ChatThread, NotificationsPanel) all unsubscribe on unmount. |
| Budget range schema unbounded | min/max bounds + `max >= min` refine exist. |
| Account deletion lacks confirmation | Type-"DELETE" confirm dialog exists in AccountView. |
