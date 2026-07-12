# Master Tour — Functional Audit & Capture Template

> **Purpose.** A structured way for *you* (a paying Master Tour subscriber) to document the existing app so we can build a **faithful functional replica with our own modern design** (see `MASTER_TOUR_CLONE_PLAN.md`). This captures *what it does and how it's organised* — its workflows, screens, fields, and navigation — which is legitimate competitive analysis.
>
> **Guardrails (keep us clean):**
> - **You** drive this from your own logged-in account. Do **not** put your Master Tour password in any file or share it — we never automate a login to their service (their ToS forbids automated access / building a competitor via their app).
> - We replicate **functionality + navigation + familiar UX conventions**, skinned with **our own brand and a more modern design** (plan §17). We do **not** copy their trademarked branding, exact artwork/icons, marketing copy, or code.
> - Screenshots you take of *your own* account are fine to paste to me — I'll use them to document structure and design our own equivalent, not to reproduce their visuals pixel-for-pixel.
>
> **How to use:** walk the app top to bottom, copy the "Capture block" below for each screen, and fill it in. Paste screenshots inline or send them in chat referencing the screen name. Don't over-polish — bullet notes are perfect.

---

## 0. Capture conventions
- **Screenshot naming:** `MT-<area>-<screen>.png` (e.g. `MT-travel-flightgrid.png`) so we can line them up with screens.
- For each screen note **both** where it helps: **Desktop app** vs **Mobile app** vs **Web portal** (they differ a lot — the mobile/desktop split matters for our PWA).
- Capture the **empty state** and a **filled/real** state where you can — empty states reveal the intended workflow.

**Capture block (copy per screen):**
```
### <Area> → <Screen name>
- Nav path: (how you get here — which tab/menu)
- Platform: desktop / mobile / web portal
- Purpose: (one line — what this screen is for)
- Key data shown: (fields, columns, cards)
- Actions/buttons: (create/edit/delete, exports, etc.)
- States/filters: (tabs, sorts, filters, statuses, confirmed/unconfirmed)
- Permissions: (who can see/do this — admin/manager/accounting/crew)
- Mobile vs desktop differences:
- What's GOOD (keep it): 
- What's CLUNKY (improve in our modern version):
- Screenshot: MT-...
```

---

## 1. Global / cross-cutting (fill once)
- **Top-level navigation / tabs** (list them in order — this becomes our tab structure): …
- **Terminology glossary** (their exact words → so ours feel familiar): Tour, Day, Event, Advance, Day Sheet, Personnel, … (add every noun/verb they use)
- **Layout conventions:** where nav lives (top/side/bottom), how a "day" is presented, list vs grid vs calendar, colour meaning (status colours), density.
- **Interaction patterns:** inline-edit vs modal? keyboard shortcuts? tab-to-next-field? drag to reorder? copy-a-section?
- **Global states:** confirmed vs unconfirmed, visibility/hidden items, offline indicator, sync/last-updated.
- **Onboarding / first-run:** what the very first experience is after login.

---

## 2. Screens to capture (apply the Capture block to each)

Work through these areas — they mirror the modules in `MASTER_TOUR_CLONE_PLAN.md §5–6` so we can map 1-to-1. Tick as you go.

**Auth & account**
- [ ] Login / signup / password reset
- [ ] Account & profile settings, notification preferences
- [ ] Organization / team & permissions management (roles: admin / manager / accounting / crew)
- [ ] Billing / subscription screen

**Tours & structure**
- [ ] Tours list / dashboard (all tours, switching between them)
- [ ] New-tour setup wizard (date range → day creation)
- [ ] Tour overview / dashboard (day-at-a-glance widgets, map)
- [ ] Day (Tour Date) detail — the core screen
- [ ] Day types (show / travel / off / press) and how you set them

**The day's contents**
- [ ] Schedule items (add/edit — fields, times, visibility, reminders)
- [ ] Notes
- [ ] Publicity items (if present)
- [ ] Files / attachments

**Events (per show)**
- [ ] Event detail (venue, promoter, production, facilities, logistics, local crew, labor call)
- [ ] Guest list (pass types, allotments, enforced caps, requests/approval, cutoff/lock)
- [ ] Set list (songs, guest performers, tech notes)
- [ ] Settlement / accounting (revenue, expenses, ticket types, P/L, exports)

**Advancing**
- [ ] Advance screen (checklist/template, per-show status: not started/sent/confirmed)
- [ ] Advance templates / template gallery

**People & places**
- [ ] Tour Personnel (per-diem, bus/radio detail, roles, visibility)
- [ ] Contacts & Companies (+ how import works, e.g. .vcf)
- [ ] Venue database (search, auto-fill, fields, key contacts, production specs)
- [ ] Crew database (the big shared directory), if visible on your plan

**Travel**
- [ ] Travel overview / the "flight grid" or travel list
- [ ] Flight item (airline/flight #, live status/FlightAware, gate)
- [ ] Ground item (drive-time/distance/routing)
- [ ] Hotels & rooming list
- [ ] TripIt / calendar-subscription / integrations screens

**Reports & output**
- [ ] Day sheet (dailies) — the printable/shareable artifact
- [ ] Multi-day print / "tour book" builder + template gallery
- [ ] Exports (PDF, CSV — what exactly exports, and to where)

**Comms & notifications**
- [ ] Push notification composer (TM → crew broadcast) + push history
- [ ] Reminders on items
- [ ] Any in-app messaging/chat

**Mobile app specifics (walk the phone app separately)**
- [ ] Mobile home / "today" view
- [ ] What the mobile app can EDIT vs only VIEW (this defines our mobile-first parity target)
- [ ] Offline behaviour: turn on airplane mode — what still works? sync-back behaviour?
- [ ] Guest-list submit on mobile

---

## 3. Workflow walkthroughs (record the click-path end-to-end)
For each, note every step, screen, and decision — these become our test cases (plan §18) and the "it works like Master Tour" proof:
- [ ] **Build a tour from scratch** (create → set date range → set day types → add venues → add personnel → build schedule → generate a day sheet → invite crew).
- [ ] **Advance a show** (open advance → fill/confirm → status).
- [ ] **Add travel** (a flight + a hotel + a drive) and see it on the day.
- [ ] **Run a guest list** (set allotments → a crew request → approve → export).
- [ ] **Settle a show** (enter numbers → P/L → export).
- [ ] **Day-of update** (change a set time → how crew are notified → what their phone shows).

---

## 4. Modern-redesign notes (our edge)
As you go, flag anything that feels dated/slow/annoying — this is where "slightly more modern design" pays off:
- Screens with too many taps / buried actions:
- Anything slow, laggy, or crash-prone:
- Places our **map/community** (plan §5.16) would add value they don't have:
- Places our **AI** (ingest a PDF, ask-the-tour) would remove manual work:
- Mobile gaps (things you can only do on desktop that should be on the phone):

---

## 5. Priority for our build
Rank the areas by how essential they are to feeling like Master Tour on day one (must-have → nice-later). This tells us what to build first within the plan's phases:
1. …
2. …
3. …

---

*Once you've filled even Sections 1–3, paste it (and screenshots) back to me and I'll turn it into a screen-by-screen build spec that maps onto the phases in `MASTER_TOUR_CLONE_PLAN.md`, with our modern design.*
