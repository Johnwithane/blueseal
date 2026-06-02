# Blue Seal — UI/UX Audit & Unification Plan

## Implementation status (updated)

All seven phases were executed on `claude/ui-ux-audit-unification-839kN`. Every
commit passed `lint && build && test:run`; no Firebase rules/functions/indexes
were touched, so no deploy was required.

- ✅ **Phase 0** — live job-detail status (`subscribeJob`), B1 decline-dialog,
  B2 trade label, B3 onboarding title, B4/R3 missing tokens.
- ✅ **Phase 1** — PrimeVue branded to Blue Seal blue (`src/theme/preset.ts`).
- ✅ **Phase 2** — radius/micro-type/elevation scales + tokenized job-status
  palette + `skills/design-system.md`.
- ✅ **Phase 3+4** — `hybrid` layout + Home→dashboard redirect + layout
  crossfade; nav-schema fixes (admin mobile home tab, tradie Profile dedup).
- ✅ **Phase 5** — `StatusBanner`, `verificationStatus.ts`, shared `.bs-cert-card`
  CSS, `VerifiedBadge` covers all four trust signals, `useConfirmAction`
  replaces all 5 `window.confirm()` calls.
- ✅ **Phase 6** — admin queues (vetting + disputes) reflow as card rows;
  terminology aligned to "Unverified".

**Deliberately deferred (follow-ups, not blockers):**
- Full `<VerificationUploadCard>` base-component *merge* — the cards differ
  enough that a merge is risky; instead the shared CSS + status vocabulary were
  unified, which captures most of the consistency win.
- `<TabBar>` extraction (JobTabBar + 2 inlined copies) and a shared
  `<LoadingState>`/skeleton convention — mechanical but broad; not yet done.
- `ApplicationReviewView`'s 5 near-identical reject dialogs (dedup pending).
- The `AdminDashboard` backfill/migration card — left in place pending
  confirmation that prod backfill is complete (don't remove one-way tools blind).

Original plan follows unchanged for reference.

---

> Status: **proposal for review**. Produced from a five-front audit of the entire `src/` frontend
> (93 components) covering the design system, navigation/chrome, and the client, tradesperson,
> and admin journeys. No application code has been changed yet — this document is the plan.
>
> Companion docs: `design.md` (what we build), `CLAUDE.md` (how we build), `TECH_STACK_SETUP.md` (setup).

---

## 1. Executive summary

The app is **architecturally healthy** — `.bs-card`/`.bs-container` are widely adopted, the per-feature
loop has been followed, banners and status chips mostly reuse shared ideas, and several surfaces
(the onboarding wizard, the Quote/Finish sheets, the single sticky job CTA) are genuinely polished.

What makes it *feel* inconsistent is **not** a hard fork between roles. It's two root causes plus a
set of missing shared primitives that let small divergences accumulate:

1. **Two chrome systems that fight each other.** A "public" world (top-bar `AppHeader` + footer) and
   an "app" world (left `SidePanel` + mobile `BottomNav`) are selected per route by `meta.layout`.
   Authenticated users are thrown between them mid-journey — signing in jumps top-bar → side-panel;
   a client tapping "Find a tradesperson" or "Post a job" from the app shell gets ejected *back* into
   the marketing chrome. Notifications, role-switching, and the account menu are each implemented
   **two or three different ways** across the two worlds. This is the "two different apps" feeling.

2. **The component library isn't branded.** PrimeVue runs the **stock Aura preset with zero
   customization** (`src/main.ts:18-23`), whose `primary` is emerald **green**. Every default
   PrimeVue Button, focus ring, selected row and checkbox renders green, while the hand-styled
   chrome uses Blue Seal **blue**. The app literally renders in two color systems at once — which is
   also *why* 26 files hand-roll their own buttons to get blue, creating a second button language.

On top of those: **two design tokens are referenced but never defined** (`--bs-surface-alt`,
`--bs-text-muted`) — so ~25 hover/active/muted-text styles silently render broken in production —
and the absence of shared `StatusBanner`, `VerificationUploadCard`, `TabBar`, `LoadingState`, and
`PageHeader` primitives has let the same patterns drift into 4-5 variants each.

**The good news:** because the drift is structural (missing primitives) rather than a deliberate
per-role fork, a relatively small set of foundational fixes propagates across the whole app. Fixing
the PrimeVue preset alone re-brands 63 Button-using files in one change.

---

## 2. Root-cause findings (ranked by leverage)

| # | Finding | Severity | Evidence | Fix leverage |
|---|---------|----------|----------|--------------|
| R1 | PrimeVue uses stock Aura (green) primary, unbranded | **HIGH** | `src/main.ts:18-23` — no `definePreset`, zero `--p-*` overrides | One preset change re-brands all 63 Button files + every focus/selected state |
| R2 | Two chrome systems; authed users bounced between them | **HIGH** | `src/App.vue:111-129`, `router/index.ts` (layout per route), `useNavItems.ts` | Collapse to one shell for authed users |
| R3 | `--bs-surface-alt` (19×) & `--bs-text-muted` (6×) referenced, never defined | **HIGH** | `main.css:4-20` vs usages in `ProfileMenu.vue:99,102`, `NotificationsPanel.vue`, `JobList.vue:375`, +11 files | Define 2 tokens — pure additive, near-zero risk |
| R4 | Notifications / role-switch / profile-menu each built 2-3× | **HIGH** | `AppHeader.vue:92-226` vs `shell/{NotificationsButton,RoleSwitcher,ProfileMenu}.vue` | Delete header duplicates once authed users live in shell |
| R5 | No shared `StatusBanner` — 4 banner visual languages | **HIGH** | `TradieStatusBanner.vue`, `OnboardingWizard.vue:715-779`, `JobDetailView.vue:749-928` (border-l-4 ×7), PrimeVue `Message` | One primitive routes all "status + next step" UI |
| R6 | No shared verification-upload card — 3 copy-pasted + 1 divergent | **HIGH** | `Cert/Insurance/Wsib UploadCard.vue` (identical `.bs-cert-card` CSS), `IdUploadCard.vue` (different) | Extract `<VerificationUploadCard>` |
| R7 | Status→severity maps duplicated 5+ times | **MED** | upload cards, `ApplicationReviewView.vue:229`, `DisputesQueueView.vue:49-62`, `PayoutsPanel.vue:294`, `BrowseJobsView.vue:96` | One `verificationStatus.ts` + always render via `Tag` |
| R8 | Hardcoded values sprawl: 120 hex, 38 rgba, 17 radii, 53 sub-12px font sizes | **HIGH** | `OnboardingWizard.vue` (25 hex), `HomeView.vue` (19), `JobList.vue`/`KanbanBoard.vue` status palette | Add radius/micro-type/elevation scales + ban raw brand hex |
| R9 | Admin queues use `DataTable` that doesn't reflow at 375px | **HIGH** | `VettingQueueView.vue:44`, `DisputesQueueView.vue` (only 2 DataTable users in app) | Move to card-row list (rest of app's idiom) |
| R10 | Typography: `h1-h6 {font-weight:400}` vs `font-bold` in 27 files; no scale | **MED** | `main.css:35-39` vs view headings; h1 uses 8 different class combos | Publish type scale; resolve bold conflict |
| R11 | 5 different loading presentations; uneven empty states; no skeletons | **MED** | `SearchView.vue:311`, `JobPostDetailView.vue:270`, `InvoicePayView.vue:197`, etc. | `<LoadingState>` + skeleton convention |
| R12 | Missing page titles app-wide; inconsistent back-nav (3 patterns); `window.confirm()` ×3 | **MED** | dashboards have no `<h1>`; `JobDetailView.vue:707` hardcoded back; `CertUploadCard.vue:162` etc. | `<PageHeader>` + history-aware back + `useConfirm` |

### Functional bugs found during the audit (fix immediately, independent of redesign)

- **B1 — Unreachable decline dialog.** `ClientQuoteApprovalBanner.vue`: "Discuss / change" (line 141)
  calls `openDeclineDialog()` but the `<Dialog>` (lines 193-222) lives inside the `v-else` waiting
  stub, so in the normal state **nothing opens**. The client cannot decline/discuss a quote. (HIGH)
- **B2 — Raw enum on the client dashboard.** `JobList.vue:271` renders `{{ job.trade }}`
  (`"general_contractor"`) instead of `tradeLabel(job.trade)` used everywhere else. (HIGH-visibility)
- **B3 — Invisible onboarding title on mobile.** `OnboardingWizard.vue:677` sets the h1 to
  `text-xs` with `whitespace-nowrap` at 375px — the most important tradie screen's title is ~12px.
  Almost certainly a typo for `text-base`/`text-lg`. (MED, trivial)
- **B4 — Unfallbacked undefined token.** `JobList.vue:375` `background: var(--bs-surface-alt)` (no
  fallback) → transparent chip background in prod. Fixed by R3. (MED)

---

## 3. The unification plan (phased)

Phases are ordered so each lands independently, is reviewable, and de-risks the next. Every phase
follows the `CLAUDE.md` loop (plan → build → `lint && build && test:run` → commit). Phases that
touch only the frontend need no Firebase deploy; none of this plan touches rules/functions.

### Phase 0 — Quick wins & live bugs (½ day, near-zero risk)
*Ship the broken-things fixes before any redesign, so the baseline is correct.*
- Define `--bs-surface-alt` and `--bs-text-muted` in `main.css` (R3, B4). Converge `--bs-text-muted`
  onto the existing `--bs-muted` value.
- Fix B1 (move the decline `<Dialog>` out of `v-else`), B2 (`tradeLabel`), B3 (mobile h1 size).
- **Acceptance:** hover/active states visibly render; client can open the discuss-quote dialog;
  dashboard cards show "General contractor"; onboarding title legible at 375px.

### Phase 1 — Brand the component library (1 day, high visual impact)
*The single highest-leverage change. Do it early so later work builds on branded components.*
- Add `src/theme/preset.ts`: `definePreset(Aura, {...})` mapping `semantic.primary` to the
  `--bs-blue` ramp (`--bs-blue-light` → `--bs-blue` → `--bs-blue-dark`) and surfaces to the
  slate/`--bs-bg` neutrals. Wire it in `main.ts:18-23`.
- Audit the 26 hand-rolled buttons; retire the ones that only existed to get blue, keeping
  intentional gradient CTAs.
- **Acceptance:** PrimeVue Buttons, focus rings, selected rows, checkboxes render Blue Seal blue;
  visual regression pass across one screen per role at 375px + desktop.
- **Decision needed from Johnny** before merge — this re-skins the whole app (see §6).

### Phase 2 — Finish the design-token foundation (1-1.5 days)
*Make the token system actually enforce consistency.*
- Make `--bs-amber` real (route the 6 `#f59e0b` literals through it). Ban raw brand hex
  (`#49a1d3/#1d406a/#a0d6f1`) — replace with `var(--bs-*)`.
- Add and document scales: **radius** (collapse 17 ad-hoc values → ~4 steps), **micro-type** (the
  53 sub-12px arbitrary sizes → 1-2 caption tokens), **elevation** (≈10 shadow recipes → 2-3).
- Tokenize the job-status palette (`JobList.vue:80-91`, `KanbanBoard.vue`) and the AI-accent
  indigo/violet; reconcile with the existing `.bs-pill` semantic states.
- Resolve the heading weight conflict (R10) and publish a type scale (display/h1/h2/h3/body/caption).
- Add an ESLint rule (or stylelint) banning raw hex in component `<style>`/arbitrary Tailwind values.
- **Acceptance:** documented scales in `main.css` + a short `skills/design-system.md`; lint catches
  new raw-hex usage.

### Phase 3 — Unify the app chrome (2-3 days, addresses the #1 complaint)
*One navigation world for authenticated users.*
- Make the authenticated experience use the shell **everywhere**: move `/search` and `/jobs/post`
  to `layout:"app"` for signed-in users; keep `layout:"public"` only for logged-out
  marketing/auth/legal. Logged-out visitors keep `AppHeader`; logged-in users never see it.
- Strip the now-duplicate chrome from `AppHeader.vue` (notifications popover, role-switch dropdown,
  account menu) — it serves only logged-out visitors after this (R4).
- One implementation each: Notifications (`NotificationsButton`), role-switch (the `RoleSwitcher`
  segmented-pill model), Profile (a real `ProfileMenu` sheet/popover that surfaces Sign out +
  role-switch + Payouts at 1-click depth, matching the old header).
- Add a `<Transition>` to the public↔app layout swap (today it's a bare `v-if`); the app spends 1.2s
  on role-switch animation but nothing on the more jarring chrome swap.
- **Acceptance:** no route transition flips a signed-in user between chrome systems; one notification
  trigger, one role switcher, one account menu.

### Phase 4 — Rationalize the nav schema (1 day)
*Consistent destinations across roles (`useNavItems.ts`).*
- Standardize the home label/matcher (client+tradie "Jobs", admin "Dashboard" — but one matcher
  approach); give admin a **mobile** Dashboard tab (`mobile:true`); add admin "Site content" to
  mobile or accept desktop-only deliberately.
- Remove the duplicate tradie-only "Profile" row.
- Model Notifications as an explicit popover-trigger type, not a fake `to:""` nav item that can never
  be active.
- Standardize back-navigation: one shared, history-aware back affordance (`router.back()` + sensible
  fallback) replacing the 3 hardcoded patterns; de-risks the `mobileCompact` `/jobs/:id` stranding
  where mobile users lose all nav.
- Reconcile orphaned/duplicated paths (`/my-applications` shows in public header but not the shell;
  it's also a tab inside the dashboard — pick one).
- **Acceptance:** per-role nav table is consistent; no orphaned destinations; back always works.

### Phase 5 — Extract shared primitives (2-3 days)
*Kill the 4-5-variant drift by giving each pattern one home. This is where "modern + consistent"
becomes structural.*
- **`<StatusBanner severity icon title :cta>`** (R5) driven by `--bs-*` — route all 4 banner
  families through it (incl. replacing the wizard's hand-rolled banner with `TradieStatusBanner`).
- **`<VerificationUploadCard>`** (R6) — migrate Cert/Insurance/WSIB/ID onto one shell; unify the 4
  status vocabularies; pull `expiresAt` coercion into `useFormatters`.
- **`verificationStatus.ts`** util + always-`Tag` rendering (R7) — fold in payout-history pills,
  application pills, cert/id tags.
- **`<TabBar>`** — one sticky underline bar for JobTabBar / TradieDashboard / AccountView (3 inlined
  copies today).
- **`<LoadingState>` + skeletons** and a consistent `.bs-empty` empty-state convention (R11).
- **`<PageHeader>`** (title + optional back/actions) — every view gets a real `<h1>` (R12).
- **One verification/trust `<Badge>`** — replace the hand-rolled emerald/blue pills in
  `JobPostDetailView.vue:418-431`; one visual language for trust signals (Blue Seal's whole value prop).
- Replace the 3 `window.confirm()` calls with `useConfirm` (R12).
- **Acceptance:** grep shows single source for each primitive; the upload-card step and banner rail
  read as one system; AccountView (1649 lines) shrinks as logic moves into primitives/composables.

### Phase 6 — Admin parity & per-role polish (1-2 days)
- Move `VettingQueueView` + `DisputesQueueView` off `DataTable` onto the shared card-row list (R9) so
  they reflow at 375px and match the rest of the app; or commit to a responsive `DataTable` wrapper.
- Remove/relocate the 120-line dev migration card off `AdminDashboard` (`:225-346`) — its own comment
  says to delete it once backfill is done.
- Unify the 5 near-identical reject dialogs in `ApplicationReviewView` into one `<RejectReasonDialog>`;
  make `DisputeDetailView`'s read-only-by-design stance visually explicit next to it.
- Terminology pass: pick "tradesperson/tradespeople" as the user-facing noun (or explicitly allow
  "pro" as marketing voice); unify "Unverified" vs "Not yet verified".
- **Acceptance:** admin reflows on mobile; admin reads as the same product; one terminology guide.

---

## 4. New shared primitives (inventory)

These don't exist yet and are the backbone of Phase 5. Proposed homes follow existing conventions:

| Primitive | Replaces | Home |
|-----------|----------|------|
| `StatusBanner.vue` | 4 banner variants, 7 inlined `border-l-4` blocks | `src/components/` |
| `VerificationUploadCard.vue` | Cert/Insurance/WSIB/ID card duplication | `src/components/` |
| `TabBar.vue` | JobTabBar + 2 inlined copies | `src/components/` |
| `LoadingState.vue` + skeletons | 5 ad-hoc loading treatments | `src/components/` |
| `PageHeader.vue` | missing `<h1>`s + ad-hoc back links | `src/components/` |
| `TrustBadge.vue` | hand-rolled emerald/blue pills | `src/components/` (consolidate w/ `VerifiedBadge`) |
| `verificationStatus.ts` | 5+ status→severity maps | `src/utils/` (parallel to `jobStatus.ts`) |
| `theme/preset.ts` | unbranded Aura | `src/theme/` |
| `AdminPageHeader.vue` (opt.) | per-screen admin headers | `src/components/admin/` (dir doesn't exist yet) |

---

## 5. Proposed token additions (`main.css`)

```css
:root {
  /* --- fixes (Phase 0) --- */
  --bs-surface-alt: #f9fafb;           /* neutral hover/zebra/unread tint */
  --bs-text-muted: var(--bs-muted);    /* converge the typo'd fork */

  /* --- scales (Phase 2) --- */
  --bs-radius-sm: 6px;
  --bs-radius:    12px;   /* matches .bs-card today */
  --bs-radius-lg: 16px;   /* matches .bs-trade-tile today */
  --bs-radius-pill: 999px;

  --bs-text-micro: 0.6875rem; /* 11px — replaces the text-[10/11px] sprawl */

  --bs-shadow-sm: 0 1px 2px rgba(15,23,42,0.04);   /* = current .bs-card */
  --bs-shadow-md: 0 8px 24px -12px rgba(29,64,106,0.25);
}
```
(Exact values to confirm during Phase 2; this is the shape, not the final palette.)

---

## 6. Decisions needed from Johnny

1. **PrimeVue re-skin (Phase 1):** OK to map PrimeVue's primary to Blue Seal blue app-wide? This
   changes the look of every default Button/control in one commit (intended — it's the fix), but
   it's a visible change worth a heads-up before merge.
2. **Terminology:** "tradesperson" everywhere, or keep "pro" as casual marketing voice on the
   homepage? (Affects copy in `HomeView`, `ProspectProfile`, request views.)
3. **Admin on mobile:** treat the admin console as mobile-first like the rest of the PWA (move queues
   off `DataTable`), or accept admin as a desktop-first surface and just stop it breaking at 375px?
4. **Scope/sequencing:** ship phases incrementally for review (recommended — matches "one feature at
   a time"), or batch the foundation (Phases 0-2) into one PR?

---

## 7. Suggested sequencing

```
Phase 0 (bugs+tokens)  →  Phase 1 (preset)  →  Phase 2 (token scales)
        ↓
Phase 3 (chrome unify) →  Phase 4 (nav schema)
        ↓
Phase 5 (primitives)   →  Phase 6 (admin parity + polish)
```

Phases 0-2 are the foundation and unblock everything else; they're low-risk and high-visual-impact.
Phase 3 is the one that most directly answers "it feels like two different apps." Phases 5-6 are
where the long-tail consistency is won.

Estimated total: ~10-13 focused days, fully reviewable in 6-7 increments.
