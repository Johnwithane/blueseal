# Build Progress — the loop's state file

> The `/loop` build reads this at the **start** of every iteration and updates it at the **end**. It is the single source of "where are we / what's next / are we blocked." Keep it accurate — it's how work survives the ephemeral container and how the next iteration knows what to do.

## STATUS
- **Current phase:** `Phase 0 — Fork & rebrand`
- **Next action:** Strip Blue Seal domain (§13 map), rename role enum → `crew/artist/tourManager`, stand up §17 design tokens + §5.16/community domain shells, rebrand to `<PROJECT>`, get `lint && build && test:run` green.
- **⛔ Blocked on (human):** _none_ — (if set, the loop must STOP and tell the user, not spin)
- **Last commit:** _n/a_

## Rules for each iteration (the loop enforces these)
1. Do **one focused unit** (a phase sub-step), not a whole phase, if a phase is large.
2. **Gate before done:** `lint && build && test:run && test:rules` pass **and** the phase's Playwright spec (`e2e/happy-paths/NN-*.spec.ts`) is green against the emulators (§18). Fix forward if red.
3. **Upkeep (§19):** update Help Center (`help.ts`), QA (`qaChecklist.ts` + `QA_HAPPY_PATHS.md`), and Terms/Privacy if data collection/sharing/processing changed.
4. **Deploy-before-commit** for any rules/functions change (or rely on the CI on merge).
5. **Commit + push**, then update STATUS above.
6. If the next step needs human input (Firebase values, API keys, a decision) that isn't in the repo → set **Blocked on**, tell the user, and **stop the loop**.

## Phase checklist (tick as gates pass — see plan §10, §18)
- [ ] **Phase 0** — Fork, strip, rename roles, design tokens, rebrand, green build
- [ ] **Phase 1** — Bands, Tours & membership (roles/rules) · spec `01-auth-roles`
- [ ] **Phase 2** — Tour spine: Days + Schedule · `02-tour-spine`
- [ ] **Phase 3** — Venues, Contacts, Personnel + Google Places · `03-venues`
- [ ] **Phase 4** — Events, Guest Lists, Set Lists · `04-guestlist`
- [ ] **Phase 5** — Travel: Flights + Accommodations (+ visa tracker, reroute) · `05-travel`, `05-visa`
- [ ] **Phase 6** — Advancing + Day Sheets (+ stage plots/tech packs + public links) · `06-daysheets`, `06-stageplots`
- [ ] **Phase 7** — Offline-first · `07-offline`
- [ ] **Phase 8** — Budget, Settlement (+ merch) · `08-money`
- [ ] **Phase 9** — Crew Chat + Notifications · `09-chat`
- [ ] **Phase 10** — AI: ingestion + assistant · `10-ai`
- [ ] **Phase 11** — Launch readiness + Master Tour importer · `11-import`
- [ ] **Phase 12** — Community foundation: Places DB + Band Profiles · `12-community`
- [ ] **Phase 13** — Interactive Map + notes/recommendations · `13-map`
- [ ] **Phase 14** — Community feed + opt-in presence (+ gear board) · `14-feed`
- [ ] **Phase 15** — Stripe subscriptions + freemium paywall · `15-paywall`

## Iteration log (append one line per iteration)
- _(iteration 1 will add its line here)_
