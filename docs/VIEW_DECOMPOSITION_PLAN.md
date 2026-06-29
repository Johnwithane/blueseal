# Mega-View Decomposition Plan

> **Goal:** break the 5 oversized views into small, **reusable** components + composables,
> bringing them toward the repo's <200-line component guideline **without changing behaviour**.
>
> **Why reuse-first:** all 5 views re-implement the same handful of UI patterns (section cards,
> photo upload, stat tiles, review cards, wizard steps, labelled fields). We build those **once**
> as a shared kit (Phase 0), then each view *consumes* the kit instead of carrying its own copy.
> That kills cross-view duplication, not just per-view bloat.

## How to use this doc

- **One view per local session.** These need to be clicked through live (no test coverage of the
  auth-gated surfaces), so do them where you can run the app — not in a headless Claude session.
- **One PR per view** (Phase 0 kit pieces can share a PR or land alongside the first view that needs them).
- **Tick the checkboxes** as you go — this file is the tracker. Commit the ticks with the work.
- **Each extraction step is independently shippable.** Extract one piece, run the gates, click the
  manual-test surface at **375px**, commit, repeat. Never extract everything in one commit.

## Working method (per extraction step)

1. Pick the next unchecked item (top-down within a view — they're ordered lowest-risk first).
2. Move the markup/logic into the new component/composable **verbatim** — no "improvements" while moving.
3. Wire props/emits (template) or returned refs (composable). Parent passes data down; **data-loading
   and side-effects stay in the parent or a composable**, presentational children take typed props.
4. `npm run lint && npm run build && npm run test:run` — must stay green.
5. **Manually verify at 375px** (and 1440px for the desktop-only bits) — see each view's test surface.
6. Commit: `Refactor(<view>): extract <Component>`. Tick the box.

### Guardrails

- **Behaviour-preserving only.** Same DOM, same classes, same emitted events, same validation gates.
  If a piece can't be cleanly separated (shared mutable ref, observer, slot coupling), leave it and note why.
- **Reusable components go in `src/components/`** with generic names + a generic props API.
  **View-private components go in `src/components/<view>/`** (or `src/features/<view>/`) and may be view-specific.
- **Composables go in `src/composables/`**; reuse the existing barrel (`composables/index.ts`).
- Keep `useSeo()` / head logic, route-query handling, and `onUnmounted` cleanup **in the parent view**.

---

## Master progress tracker

- [ ] **Phase 0 — Shared component kit** (build the reusable primitives)
- [ ] **View 1 — PitchView.vue** (1,805 → ~180) — *lowest risk, warm-up*
- [ ] **View 2 — TradieProfileView.vue** (2,117 → ~500)
- [ ] **View 3 — AccountView.vue** (1,875 → ~250)
- [ ] **View 4 — OnboardingWizard.vue** (1,948 → ~200)
- [ ] **View 5 — JobDetailView.vue** (1,745 → ~400) — *highest risk, money flows, do last*

**Suggested order:** Phase 0 primitives are built lazily — create each one the first time a view needs it
(don't build the whole kit up front). Do PitchView first (almost pure template, safe warm-up that also
yields the marketing-card primitives HomeView can reuse), then TradieProfile/Account/Onboarding, and
JobDetailView **last** because it drives quote-accept / invoice / cancel money flows.

---

## Phase 0 — Shared component kit (the reusable primitives)

These recur across multiple views. Build each one once (with a manual test in isolation), then adopt it
everywhere the per-view sections below reference it. **Each is small and behaviour-neutral.**

| Primitive | What it is | API (sketch) | Reused by |
| --- | --- | --- | --- |
| **`SectionCard.vue`** | `bs-card` + header (`title`, optional `subtitle`, `#action` slot) + default-slot body. The single most-repeated shell. | props: `title`, `subtitle?`; slots: `default`, `action` | Account (every section), TradieProfile (About/Services/Reviews/Recommendations), JobDetail panels, Pitch bands |
| **`PhotoUploadField.vue`** + **`usePhotoUpload.ts`** | Avatar/preview + "upload" button + hidden file input; composable owns compress→storage→state. | component props: `imageUrl`, `uploading`, `shape?`; emits `change(file)`. composable returns `{ uploading, onFile, pickedUrl }` | Account (profile photo), TradieProfile (photo **and** cover), Onboarding (Basics photo) |
| **`StatTile.vue`** | A `{ value, label }` tile (big number + caption), optional `live`/`light` variants. | props: `value`, `label`, `live?`, `light?` | TradieProfile (facts), Pitch (market / unit-econ / live-status tiles) |
| **`ReviewList.vue`** (+ `RatingDimensionBars.vue`) | Generic rating summary + review list; not tradie-specific. | props: `rating`, `ratingCount`, `dimensions?`, `reviews[]` | TradieProfile (native reviews **and** Google reviews) — could also surface on search cards |
| **`EndorsementChips.vue`** | Two-direction "recommended by / recommends" chip lists with profile links. | props: `incoming[]`, `outgoing[]`, `manageLink?` | TradieProfile (vouches); generic enough for any peer-endorsement |
| **`WizardStep.vue`** + **`useWizard.ts`** | Step shell (title + body slot + Back/Next nav + per-step validity) and a step-state-machine composable (current step, completed map, `goNext` w/ validation). | step props: `title`, `valid`, `isFirst/isLast`; emits `next`/`back`. composable: `{ step, completed, goNext, firstIncomplete }` | Onboarding (7 steps); reusable by PostJobView / RequestQuoteView multi-step flows |
| **`FormField.vue`** | Label + control slot + `<FieldError>` in one wrapper (pairs with the existing `useFormErrors`). **Optional** — adopt only where the 3-line label/input/error pattern is uniform; don't force it on grid/Select/checkbox fields. | props: `label`, `error?`, `optional?`; slot: control | Account forms, Onboarding steps, admin forms |
| **`useAutosaveDraft.ts`** | Debounced draft autosave (dirty flag, save status, flush-on-leave), guarded by a `readOnly` predicate. | `{ dirty, saving, status, schedule, flush }` | Onboarding (draft autosave); reusable by any long form |
| **Pitch marketing kit** (`PillarCard.vue`, `StatTile.vue`, `StepRow.vue`, `CTABand.vue`, `FaqList.vue`) | Data-driven marketing primitives (see View 1). | data arrays → `v-for` | PitchView **and** HomeView (both are marketing surfaces — extract once, adopt in both) |

> **Adoption rule:** when a view section below says *"use `SectionCard`"*, that means: if the primitive
> doesn't exist yet, build it (Phase 0) in this same PR, manual-test it in isolation, then adopt it.

---

## View 1 — PitchView.vue  (1,805 lines → ~180)

**Route:** `/pitch` (password-gated investor/partner deck). **~95 script / ~1,710 template** — almost pure
presentational markup with lots of repeated card/tile/timeline blocks. **Lowest risk; do first.**

**Strategy:** data-driven extraction — turn hand-written repeated blocks into a small component + a data array
in `src/data/pitch.ts`. Keep the password gate, scroll-progress, reveal IntersectionObserver, `useSeo`, and
live-stats fetch in the parent.

**Reusable kit produced here (also for HomeView):** `PillarCard`, `StatTile`, `StepRow`, `CTABand`, `FaqList`.

Extraction (top-down, each `v-for` over data in `src/data/pitch.ts`):
- [ ] `PillarCard.vue` (3-up card: icon/title/desc/optional image) — adopt for Problem (180–182), Solution (201–203), Why-now (233–235), AI grid (296–301). **REUSABLE**
- [ ] `StatTile.vue` — adopt for live-status tiles (315–318), market tiles (362–365), unit-econ tiles (417–421). **REUSABLE**
- [ ] `PitchRoadmap.vue` — 7 timeline nodes (335–353) over a data array. **VIEW-PRIVATE** (deck-specific copy)
- [ ] `RevenueLineCard.vue` — "where it grows" 4-up (553–576). **VIEW-PRIVATE**
- [ ] `TradeCharRow.vue` — 8 trade character images (321–328) over the trades list. **REUSABLE-ish** (any trade showcase)
- [ ] `TeamMemberCard.vue` (620–635) + `FundingBreakdown.vue` (661–666) over data arrays. **VIEW-PRIVATE**
- [ ] Move section configs into `src/data/pitch.ts`; PitchView template becomes gate + progress + topbar + section slots + footer.

**Risks:** reveal animation observer must still see `v-for`-rendered `.reveal` roots (child components apply `.reveal` to their root). Scoped band colours come from CSS vars on `.pitch-root` — children inherit, safe. Mock* components already isolated — leave them.

**Manual test (375px + 1440px):** gate unlocks; scroll-progress bar animates; every section renders top-to-bottom; reveal fade-in fires on scroll; live stats populate (fallback placeholder otherwise); all CTAs/anchors work; roadmap flips vertical→horizontal at ≥860px; no console errors.

---

## View 2 — TradieProfileView.vue  (2,117 lines → ~500)

**Route:** `/tradies/:uid` and `/u/:slug`. Public profile + owner inline-edit (tagline/bio/services/slug/photo/cover);
prospects render through the same template with limited features. **~729 script / ~1,388 template.**

**Strategy:** pull logic into composables first (no render change), then extract template sections. Several
sections are genuinely reusable.

Extraction order (lowest-risk first):
- [ ] `useProfileData.ts` — slug→uid resolve, fetch tradie/prospect, load reviews/vouches, `reloadTradie()`. **VIEW-PRIVATE**
- [ ] `usePhotoUpload.ts` (Phase 0) — adopt for both photo **and** cover upload (replaces `useProfilePhotos`). **REUSABLE**
- [ ] `useProfileSave.ts` — heart save/unsave toggle. **VIEW-PRIVATE**
- [ ] `ProfileMobileBar.vue` — sticky mobile CTA (1397–1431). **VIEW-PRIVATE**
- [ ] `EndorsementChips.vue` (Phase 0) — recommendations/vouches (1231–1313). **REUSABLE**
- [ ] `ReviewList.vue` + `RatingDimensionBars.vue` (Phase 0) — native reviews (1157–1229) **and** Google reviews (1315–1383) via the same component. **REUSABLE**
- [ ] `StatTile.vue` (Phase 0) — quick-facts (979–1002). **REUSABLE**
- [ ] `SectionCard.vue` (Phase 0) — wrap About / Services / Reviews / Recommendations section shells. **REUSABLE**
- [ ] `useProfileComputed.ts` — display computeds (trades-with-years, badge visibility, CTA, week bars). **VIEW-PRIVATE**
- [ ] `useProfileEditing.ts` — edit mode + save/cancel + slug claim. **VIEW-PRIVATE**
- [ ] `ProfileAbout.vue` (1007–1106), `ProfileAside.vue` (900–1002), `ProfileHero.vue` (800–896). **VIEW-PRIVATE**

**Risks:** v-model chains (`editTagline/editBio/editServices/slugDraft`) — use explicit `@update:x` emits. Don't expose the raw `tradie` ref for mutation; mutate in the composable. Keep `useSeo`/JSON-LD and all dialogs (BrandingPanel, UnsplashPickerDialog, PortfolioEditor) in the parent. `isProspect` drives conditional rendering across sections — pass it to each child.

**Manual test (375px):** owner edit→save tagline/bio (aside reloads); photo upload appears in hero + about; slug claim validates; heart toggle (no double state); review cards + dimension bars; Google reviews render separately; vouch chips link; mobile sticky bar shows pricing + CTA; brand colour cascades.

---

## View 3 — AccountView.vue  (1,875 lines → ~250)

**Route:** `/account?tab=profile|tradesperson|payouts|pro|account`. Multi-tab settings. **~916 script / ~959 template.**
Already composes many existing panels (Branding, Portfolio, TradieDocsManager, GoogleBusinessPanel, Vouches,
PayoutsPanel, SubscriptionPanel) — leave those; extract the **inline** sections.

Extraction order (lowest-risk first):
- [ ] `useAccountLoad.ts` — fetch user + tradie/contact docs, hydrate fields. **VIEW-PRIVATE**
- [ ] `useAccountSave.ts` — profile/tradie save + auth-store sync + toasts. **VIEW-PRIVATE**
- [ ] `SectionCard.vue` (Phase 0) — every settings section uses this shell. **REUSABLE**
- [ ] `PhotoUploadField.vue` + `usePhotoUpload.ts` (Phase 0) — profile photo (replaces inline upload). **REUSABLE**
- [ ] `FormField.vue` (Phase 0, optional) — adopt for the uniform label/input/error fields. **REUSABLE**
- [ ] `AccountPasswordSection.vue` (1644–1659) — stateless reset button. **VIEW-PRIVATE**
- [ ] `AccountEmailChangeInline.vue` (1022–1074) + `useAccountEmailChange.ts`. **VIEW-PRIVATE**
- [ ] `AccountProfileForm.vue` (name/phone/bio). **VIEW-PRIVATE**
- [ ] `AccountServiceAreaPanel.vue` (LocationPicker), `AccountInvoiceNumberingPanel.vue`, `AccountTradieProfilePanel.vue`. **VIEW-PRIVATE**
- [ ] `AccountNotificationsSection.vue` (email/WhatsApp batched + push immediate). **VIEW-PRIVATE**
- [ ] `DangerZoneCard.vue` (Phase 0) → used by `AccountDataPrivacy.vue` (export + delete dialog). **REUSABLE** shell, view-private contents
- [ ] `AccountRolesSection.vue` (role list + switch + add-role CTAs). **VIEW-PRIVATE**

**Risks:** auth-store sync after save (return reactive objects so the parent updates `auth.user`). `tradie` can be null (non-tradie users) — guard. Google Places autocomplete attaches in `onMounted` to a DOM ref — keep that wiring at the parent or pass the ref down carefully. Numbering "locked" state is computed from the tradie doc — child must receive prop updates. Push toggle is immediate (no Save) vs email/WhatsApp which batch-save — keep those flows distinct.

**Manual test (375px):** photo upload→avatar+header update; profile save (name min 2, bio 20+/blank); email-change flow; tradie company/services/billing save; invoice numbering lock + regex; service-area save (geohash recompute); discoverable toggle optimistic-revert on error; password reset toast; notifications persist across reload; data export link; delete requires typed "DELETE"; role switch changes `activeRole` + navigates.

---

## View 4 — OnboardingWizard.vue  (1,948 lines → ~200)

**Route:** `/tradie/onboarding`. 7-step wizard (Basics→Trades→Pricing→Area→Hours→Documents→Submit) with draft
autosave + a vetting state machine (draft/pending/info_requested/rejected, read-only when pending). **~841 script / ~1,107 template.**
Form state is **18 atomic refs** (no nested object) — easy to pass per-step.

**Strategy:** one component per step + extract the step state-machine and autosave into reusable composables.

Extraction order (isolated → coupled):
- [ ] `WizardStep.vue` + `useWizard.ts` (Phase 0) — step shell + state machine (completed map, `goNext` validation, `firstIncomplete`). **REUSABLE**
- [ ] `useAutosaveDraft.ts` (Phase 0) — debounced save, read-only guard, flush-on-leave. **REUSABLE**
- [ ] `StepHours.vue` (1311–1322) — AvailabilityEditor wrapper, no validation. **VIEW-PRIVATE**
- [ ] `StepArea.vue` (1291–1308) — LocationPicker + FieldError. **VIEW-PRIVATE**
- [ ] `StepPricing.vue` (1211–1288). **VIEW-PRIVATE**
- [ ] `StepTrades.vue` (1142–1208) — secondary-trade filter, yearsByTrade. **VIEW-PRIVATE**
- [ ] `StepBasics.vue` (995–1139) — 6 fields + PortfolioEditor + photo upload (use `usePhotoUpload`). **VIEW-PRIVATE**
- [ ] `StepDocuments.vue` (1325–1398) — cert/ID/insurance/WSIB cards; emits upload/delete events to parent. **VIEW-PRIVATE**
- [ ] `StepSubmit.vue` (1403–1609) — read-only review + submit gate. **VIEW-PRIVATE**

**Risks:** `saveDraft()` **intentionally excludes `vettingStatus`** (don't re-introduce it — it would demote out of the review queue). Read-only guard must survive into `useAutosaveDraft`. `yearsByTrade` orphan keys when primaryTrade changes — clean up on trade change. Cert identity is `existingCerts.find(c => c.trade === t)` — StepDocuments must emit events and the parent refetches. Photo upload triggers a denormalized copy write via `scheduleAutoSave()` — keep that hook. `documentBlockers` is shared by advance + submit — keep it one computed.

**Manual test (375px):** click all 7 steps; completed check icons; required-field validation + scroll-to-error; autosave "Saved X ago" after 1.5s; refresh restores draft + jumps to first incomplete; submit→pending+read-only; withdraw→unlock+resubmit; documents step cert add/delete gates Submit; mobile step indicators don't overflow.

---

## View 5 — JobDetailView.vue  (1,745 lines → ~400)  ⚠️ highest risk — do last

**Route:** `/jobs/:id`. The central job-pipeline screen for **both** client and tradesperson: status transitions,
quote/invoice, chat, scheduling, time-tracking, cancel/postpone, reviews. **~1,033 script / ~712 template** — this one
is **logic-heavy**, so the win is extracting **composables (state machines)**, not just template. **It drives money flows
(quote accept, invoice pay, cancel) — behaviour-preservation is paramount.**

Extraction order (safest first):
- [ ] `useJobReview.ts` — `?review=1` deep-link, review-phase computeds, banner CTA. **VIEW-PRIVATE** (Phase 1, zero-risk)
- [ ] `useJobNotes.ts` — private notes save + AI auto-log (quiet-fail). **VIEW-PRIVATE** (Phase 1)
- [ ] `JobBannerStack.vue` — the conditional banner list (1239–1385); pure template, all computeds/handlers passed as props. **VIEW-PRIVATE** (could generalise to a reusable `BannerStack` layout later)
- [ ] `useJobSubscription.ts` — job doc + dependents subscribe; **preserve the once-per-mount `loadJobDependents` gate** and the auth-race gate; return unsubscribers for `onUnmounted`. **VIEW-PRIVATE** (Phase 2, highest complexity)
- [ ] `useJobScheduling.ts` — sessions CRUD + collision dialog. **VIEW-PRIVATE** (Phase 2)
- [ ] `useJobActions.ts` — cancel/postpone/return-to-applicants; **preserve `cancelNeedsApproval` instant-vs-approval branch**. **VIEW-PRIVATE** (Phase 3, money flow)
- [ ] `useJobTimeClock.ts` — header clock-in/out + uninsured-waiver gate (**waiver must block clock-in, not session save**). **VIEW-PRIVATE** (Phase 3)
- [ ] `JobActionDialogs.vue` — collision/cancel/postpone modals. **VIEW-PRIVATE**

**Keep in the view:** `isTradie`/`isClient`, name/photo resolution chains, tab bar logic (`tabs`/`activeTab`/`validTabKeys`),
chat-overlay query handling, `showStickyCTA`, and the `route.params.id` master watch + `onUnmounted` cleanup.

**Risks (read before starting):** the `loadJobDependents` "first snapshot only" flag — if broken, schema/invoice reads
re-run on every status update. Computed dependency order (`canRequestCancel` depends on `hasPendingChange`). The waiver
gate must remain on clock-in only. Reactive subscriptions must return unsubscribers so the view can clean up. Test as
**both roles** at every status.

**Manual test (375px, both roles):** client: brief submit→quoted; review banner auto-open after payment; booking→banner;
cancel reason→"requested". tradie: prepare-quote sticky→QuoteSheet→re-send; client-accept badge; clock-in `in_progress`
gate; uninsured→sign-waiver→clock-in; schedule collision→override. Both: `?review=1` auto-opens then URL cleans (no loop);
sticky-CTA bottom reserve engages without hiding content.

---

## Reusability scorecard (what gets built once, used many times)

| Shared primitive | Built in | Then adopted by |
| --- | --- | --- |
| `SectionCard` | Account or TradieProfile (whichever first) | Account, TradieProfile, JobDetail, Pitch |
| `PhotoUploadField` + `usePhotoUpload` | Account | Account, TradieProfile (×2: photo+cover), Onboarding |
| `StatTile` | Pitch | Pitch (×3 grids), TradieProfile |
| `ReviewList` + `RatingDimensionBars` | TradieProfile | TradieProfile (×2: native+Google); candidate for search cards |
| `EndorsementChips` | TradieProfile | TradieProfile |
| `WizardStep` + `useWizard` | Onboarding | Onboarding; candidate for PostJobView / RequestQuoteView |
| `FormField` (optional) | Account | Account, Onboarding, admin forms |
| `useAutosaveDraft` | Onboarding | Onboarding; any long form |
| Pitch marketing kit (`PillarCard`/`StepRow`/`CTABand`/`FaqList`) | Pitch | Pitch **and** HomeView |

> When you finish a view, do a quick grep for the patterns it produced (e.g. other `charAt(0)` avatars,
> other `bs-card` + header shells, other Zod→error loops) and adopt the new primitive there too —
> that's how the reuse compounds beyond these 5 files.

---

## Done-criteria per view

A view is "done" when: it's under ~roughly its target line count, every extracted child is independently
testable, the reusable primitives it produced are in `src/components/` (not view-private), all gates are green,
and you've clicked the full manual-test surface at 375px. Tick its box in the master tracker and open the PR.
