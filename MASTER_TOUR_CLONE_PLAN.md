# Loadout — Design & Build Plan

> **Working codename:** **Loadout** (the flight cases that travel with every touring production — swap for the real brand later). A Master Tour–class **tour-management PWA** for the live-music industry, built on the same Vue 3 + Firebase scaffolding as Blue Seal.
>
> **What this doc is:** the equivalent of Blue Seal's `design.md` for a *new* product. It defines *what* Loadout is, the domain data model, the roles, the phased build, the competitive positioning, and exactly what carries over from the Blue Seal scaffolding vs. what gets rebuilt. It deliberately mirrors the Blue Seal `design.md` section skeleton so the same working discipline (`CLAUDE.md`) applies unchanged.
>
> **Source of truth for *how* we build:** the existing `CLAUDE.md` (core principles, per-feature loop, callable/rules/service patterns, deploy discipline, Help Center + QA upkeep). Nothing in this doc overrides it. Where the touring domain forces a deviation from a Blue Seal convention, it is **flagged explicitly** (see §7.1 — the multi-tenant rules deviation).

---

## 0. How this plan was built (research provenance)

This plan is grounded in deep research on Master Tour (Eventric) and ~30 competing/adjacent products. Master Tour's own site and support docs block automated fetch (Cloudflare 403), so product facts were reconstructed from search-indexed support articles, app-store listings, trade press, and review sites. Two facts to **re-verify in a browser before pricing decisions**: (1) Master Tour's exact current Professional price (sources split between $59.99 and $64.99/$74.99); (2) whether any separately-priced "Master Tour Personnel" add-on exists (none found). Everything below labelled from a source is cited in §11.

---

## 1. Vision

**Loadout is the single source of truth for a touring production.** A tour manager builds a tour once — dates, venues, crew, travel, schedule — and every band member and crew person carries the whole thing in their pocket, **offline, in a dead-signal load-in dock**, with push notifications when anything changes.

It replaces the fragmented reality of most tours: a WhatsApp group, a shared Google Sheet, a PDF day sheet emailed at 1am, and a tour accountant's laptop. Master Tour proved the category (250,000+ professionals, 150,000+ tours) but is anchored to an **aging desktop app** where the *building* happens — mobile can only consume and lightly edit. Loadout's wedge is to be **mobile-first and fully capable on the phone**, **genuinely offline-first**, and **AI-assisted** (Master Tour ships no AI — though the newer challengers all do, so AI intake is table-stakes, not a moat; see §11), at a price that also serves the indie/one-off-tour segment Master Tour's flat ~$65–75/mo ignores.

**The three load-bearing behaviours to nail (these are what make or break the product):**
1. **Offline-first read of the active tour** — crew open the app in a basement venue with no signal and see today's schedule, venue, hotel, and their call time. (Master Tour's #1 retained behaviour.)
2. **Change → sync → push** — the TM edits a set time, everyone's phone updates and pings. This is the connective tissue.
3. **Per-item visibility + a hard financial wall** — the guarantee and settlement are visible to the TM and accountant, never the opener's guitar tech.

---

## 2. Naming

- **Product (codename):** Loadout — a **placeholder only**. ⚠️ **This market is extraordinarily name-crowded — run a real trademark/domain clearance check before committing.** Already-taken names found in research: RoadOps, **RoadCase (roadcase.app)**, Roadbook, Daysheets, GigSheets, Tourbit, TourDeck, My Tour Book, Advance With Me, DaySync. Even "Loadout" and the alternatives below may be taken — verify. Alternatives considered: *Callsheet*, *Backline*, *Dayrunner*, *RoadCrew*. Pick before Phase 1 — the slug/manifest/theme all key off it.
- **Core artifact:** the **Day Sheet** (aka "daily") — the printable/shareable one-day summary. Keep this term; it's industry-standard.
- **Roles (see §3):** `owner`, `manager`, `crew`, `accountant`, plus platform `admin` / `qa`.
- **Domain nouns to standardise now** (they become collection names): **Tour → Day (Tour Date) → Event → Show detail**; **Venue**, **Contact**, **Personnel**, **Schedule Item**, **Travel Item**, **Guest List**, **Set List**, **Settlement**, **Advance**.

---

## 3. User Roles & Auth Tiers

> **This is the single biggest architectural difference from Blue Seal.** Blue Seal roles are **global** (a user *is* a `tradesperson` everywhere). Loadout roles are **per-tour** (or per-org): the same person can be the `owner` of their own tour and `crew` on someone else's next week. This is a **multi-tenant** model. See §7.1 for how the security rules must adapt.

### 3.1 The two-layer role model (copied from Master Tour, proven)

**Layer 1 — Platform claims (global, via custom claims — reuse Blue Seal's machinery verbatim):**
- `admin` — Loadout staff. Support desk, user management, audit. (Keep Blue Seal's `admin` exactly.)
- `qa` — capability claim that unlocks the `/qa` toolkit; never a "view". (Keep verbatim.)
- Everyone else is just an authenticated `user` at the platform layer. **Their power comes from tour membership, not a global claim.**

**Layer 2 — Tour membership role (per-tour, stored in a membership doc — NEW):**

| Role | Can do | Sees financials? |
| --- | --- | --- |
| **`owner`** | Everything on the tour incl. delete tour, manage members & their roles, all settlement. Creator of the tour. | ✅ |
| **`manager`** (TM/PM) | Build/edit everything **except** member management and settlement writes. Add/edit days, events, schedule, travel, venues, guest lists, advancing, push notifications. | ➖ read-only unless also granted accountant |
| **`accountant`** | Financial access — revenue/expense settlement, per-diem, exports. Can view all days regardless of visibility. | ✅ (this is the gated seam) |
| **`crew`** | Consume the tour on mobile/web: itinerary, schedule, travel, hotels, venue, day sheet, their own call times. Submit **guest-list requests**. Cannot edit tour structure. | ❌ |

Plus **granular guest-list sub-permissions** layered on `crew` (Master Tour has exactly this): `guestlist:submit` (request +N up to your allotment) vs `guestlist:manage` (approve/deny, see all).

**Design rationale (flag in commit):** splitting **`accountant`** and **member-management** out of an otherwise-powerful `manager` is the key sensitive seam — it mirrors Master Tour's separation of *Accounting* and *Users* from *Manager*, and it maps cleanly onto Blue Seal's own instinct to gate money explicitly.

### 3.2 Visibility (a second, orthogonal axis — also from Master Tour)

Role says *what you can do*; **visibility** says *which items you can see*:
- **Per-tour visibility** — a tour can be restricted to specific members (an opener's crew added late shouldn't see the headliner's full history).
- **Per-item visibility** — an individual schedule item, travel item, hotel, or file attachment can be hidden from selected members (financial docs, surprise-guest logistics).
- **Override:** `owner`/`manager`/`accountant` bypass item visibility. `crew` are subject to it.

Model visibility as a field on each item (`visibility: "all" | { memberUids: string[] }`), enforced in rules and filtered in queries.

### 3.3 How membership & invites work

- A user creates an account (reuse Blue Seal auth verbatim: email/password, Google, magic link).
- Creating a tour makes them its `owner`.
- They invite crew by email or **one-tap invite link** (Blue Seal already has a one-tap invite-link pattern from its job-invite flow — lift it). Invitee joins as `crew` (or a role the owner picks).
- Crew are **free forever**; only builder seats (`owner`/`manager`/`accountant`) count toward billing (see §12). This "charge the builder, crew ride free" model is what drives org-wide adoption — a TM can mandate the app to 40 crew without a per-seat fight.

---

## 4. User Flows

### 4.1 Tour Manager — build a tour (the core creation flow)
1. **Create tour** — name + date range (From/To). Wizard bulk-creates a `Day` per date.
2. **Set day types** — each Day is `show` | `travel` | `off` | `press`/`promo`. Travel/off days prompt for city → auto time-zone + routing.
3. **Add venues** — type-ahead against the shared **Venue DB**; selecting auto-fills address, capacity, contacts, production notes.
4. **Advance each show** — the **Advance** checklist/template per show day gathers production, hospitality, schedule, contacts from the venue/promoter. Status: `not started → sent → confirmed`.
5. **Add personnel** — pull from the **Contacts/Crew DB** or invite new; assign per-tour role + per-diem/bus/radio detail.
6. **Build schedule & travel** — per Day: schedule items (load-in, soundcheck, doors, set, load-out), travel items (flights with live tracking, ground with auto drive-time), hotels.
7. **Generate day sheets** — dailies + multi-day "tour book" from templates → PDF.
8. **Set visibility & invite crew** — apply per-item visibility, send invite links.
9. **Publish** — crew get access + a push.

### 4.2 Crew — consume on the road (the mobile-first flow)
1. Open app → **today's dashboard**: venue, address (tap → maps), load-in/soundcheck/set times, my call time, hotel, weather.
2. Swipe to any day → full itinerary + travel + who's on the bus.
3. **Submit a guest-list request** (+2, names) → TM approval.
4. Receive **push** on any change ("Set time moved to 21:15").
5. **All of the above works offline** — cached on first sync.

### 4.3 Accountant — settle a show
1. Open a show's **Settlement** → currency, capacity, tickets sold, comps, merch, ticket scaling, expense line items → auto P/L.
2. Export settlement (PDF + CSV; **QuickBooks/Xero-friendly CSV** = a competitive wedge Master Tour lacks).
3. Guest-list comps + ticketing counts flow **into** settlement automatically.

### 4.4 Day-of-show update (the connective-tissue flow)
TM edits an item on mobile → optimistic local write → Firestore sync → **Cloud Function fan-out push** to all affected members → their cached copy updates. Changing a Day's date cascades to its items and marks them **`unconfirmed`** (a status flag on schedule/travel items — copy this behaviour).

### 4.5 Admin (platform) — reuse Blue Seal admin console
User management, support desk (verify email, temp password, suspend/restore, soft-delete), audit log, error queue. **Lift Blue Seal's admin scaffolding wholesale**; only the domain widgets change.

---

## 5. Core Features

Ordered roughly by build priority. Each maps to a phase in §10.

### 5.1 Tours & Days (the spine)
Tour → ordered list of Days. Day carries: date, day-type, city/venue, time zone, notes, `confirmed` flag. This is the backbone every other feature hangs off.

### 5.2 Events & Show Detail
A Day (esp. `show`) holds 1..n **Events** (festival = multiple stages/sets). Event carries: venue FK, promoter, production/facilities/equipment/logistics, local crew, labor call, **guest list**, **set list**, **settlement**.

### 5.3 Schedule
Per-Day schedule items: title, start/end, details, **visibility**, **reminder**, `confirmed`. The heart of the day sheet. Mobile-editable by `manager`+.

### 5.4 Travel & Logistics — Flights & Accommodations (deep integration)
Per-Day travel items, per-traveller, visibility-aware. Three kinds, each with a real data integration behind it (see §16 for the provider/infra detail):
- **Flights (`air`)** — enter airline + flight number (or **Places-autocomplete the airport**); a Cloud Function calls the **flight-data provider (FlightAware AeroAPI, recommended — Master Tour's own choice)** to pull schedule, terminal/gate, and **live status** (delays/cancellations) starting ~48h out. Status is cached to Firestore so it renders **offline** and fans out a push on change. Assign travellers to a flight; auto-build a per-tour **flight grid** (Daysheets' signature view — match it).
- **Accommodations (`hotel`)** — **Google Places autocomplete + Place Details** to find the hotel and auto-fill address, phone, geo, photos, rating, website (no manual typing). Holds check-in/out, confirmation #, room block, nightly rate, and a **rooming list** (who's in which room). Rooming list exports to the day sheet + PDF.
- **Ground (`ground`)** — origin + destination via **Places**; a function calls the **Google Directions/Routes API** for auto drive-time, distance, and start/end **time zones**; flags "overdrive" gaps between load-out and next load-in.

Design note: flights/hotels/ground all satisfy the offline-first requirement by **caching the provider response into the travel-item doc** — the phone never calls Google/FlightAware directly (keeps keys server-side, works in a dead-signal venue, and controls API cost). See §16.

### 5.5 Contacts, Personnel & Venue DB (the three shared databases, Places-enriched)
Top-level, cross-tour collections referenced by FK (never embedded):
- **Venues** — the network-effect moat, now **Google-Places-backed**. On show creation, **Places Autocomplete** finds the venue; **Place Details** auto-fills address, geo (lat/lng + geohash), phone, website, opening hours, photos, and Google rating; we store the `placeId` for stable re-fetch. Touring-specific fields Places *doesn't* have — **capacity, production specs, key contacts, load-in notes** — are layered on top and become the proprietary data (this is where our own moat compounds, parallel to Master Tour's Venue Tech Packs). A venue can be **"claimed"** by its own team via the **Google Business Profile API** to sync verified hours/contact + let them maintain their production pack (a v1.1+ venue-side play).
- **Contacts/Companies** — people & orgs; `.vcf` import (drag-in) like Master Tour; **Places-enrich** company addresses.
- **Personnel** — tour-scoped join of a user/contact + per-tour role + per-diem/bus/radio detail.

### 5.6 Guest Lists
Per-Event. Allotments per pass/ticket type with an **Enforced** cap (crew can request only up to remaining allotment). Request → approval workflow, cutoff times, lock. Feeds comps into settlement.

### 5.7 Advancing
Per-show customizable checklist/template (production, hospitality, schedule, contacts, riders). Status pipeline. **AI-assisted intake** is a differentiator (Advance With Me already does this; Master Tour doesn't).

### 5.8 Day Sheets & Reports
Template-driven dailies + multi-day tour books → **PDF** (reuse Blue Seal's `jspdf`/`jspdf-autotable` + `pdfRender` util). Template gallery. Export tour details/personnel/settlement to CSV.

### 5.9 Budget, Settlements & Tour Finance
The money layer, gated to `accountant`/`owner`. **Two connected surfaces:**
- **Tour Budget (new — whole-tour, forward-looking).** A budget for the entire tour: **projected income** (guarantees, ticket %, merch, sponsorship) vs **projected expenses** (crew wages, per-diems, bus/ground, hotels, flights, production, visas, insurance) organised by category and rolled up per **day / leg / whole tour**. As real numbers land, actuals populate **beside** projections → live **budget-vs-actual variance**. Expenses flow in automatically from other modules: a hotel travel item's nightly rate × room-nights, a flight's cost, per-diems × personnel × days — so the budget is **derived, not re-keyed** (a Cloud Function recomputes rollups on any source change; §8). This is a genuine step past Master Tour, which is thin on forward budgeting.
- **Per-show Settlement (as before).** Per-Event revenue + expense settlement → P/L on the night; comps/ticket counts feed in from the guest list. Settlement actuals post back up into the tour budget.
- **Exports.** Per-diem sheets, budget summary, and settlements export to PDF + **QuickBooks/Xero-friendly CSV** = the finance wedge that wins switchers off spreadsheets.

Firebase leverage: budget line items are a Firestore subcollection with a **Cloud Function aggregation** maintaining denormalized rollup totals (so the mobile budget screen reads one summary doc, works offline, and never runs a heavy client-side sum).

### 5.10 Set Lists
Per-Event. Songs → { guest performers, tech notes, set-specific notes }. Optional integration with **setlist.fm API** to auto-populate played-history (note: commercial API license by negotiation; free tier is non-commercial only).

### 5.11 Files & Notes
Per-Day/Event attachments (contracts, riders, stage plots) with **visibility**. Notes per day. Storage-backed, scoped by tour + uploader (reuse Blue Seal's storage-path + upload-scoping patterns).

### 5.12 Notifications & Real-time Sync
Custom TM→crew push; per-item reminders; change fan-out. Reuse Blue Seal's notifications store + FCM SW; add tour-scoped notification types.

### 5.13 AI Assistant & AI Ingestion (Firebase-native AI)
Two AI surfaces, both server-side via Cloud Functions (reuse Blue Seal's `aiChat` callable + floating-panel pattern). **Stack: Firebase AI Logic (Vertex AI in Firebase) with Gemini**, optionally orchestrated with **Genkit** — keeps the model call inside the Firebase project (App Check-protected, no separate backend, billing on the same GCP project). See §16.
- **AI ingestion (now table-stakes — every 2024-26 competitor has it):** forward a booking/hotel/flight confirmation email or drop a rider/advance PDF → Gemini (multimodal, reads the PDF/image) parses it into **structured schedule / travel / advance line items** the TM confirms with one tap. This is the single most-copied new feature in the category — ship it, don't skip it.
- **Grounded assistant (the frontier, where the incumbent has nothing):**
  - **Day-sheet drafting** — "draft tomorrow's day sheet" from the tour data.
  - **Routing sanity** — "is this drive doable between load-out and next load-in?" (grounded in the Directions/Routes data).
  - **Budget Q&A** — "how far over per-diem are we this leg?" over the budget rollups.
  - **Ask-the-tour** — "what's the wifi password / load-in time at tonight's venue?" over the tour's own data (RAG over Firestore).
Gate behind the paid builder tier (mirror Blue Seal's paid-AI pattern). Ground every answer in the tour's Firestore data — never free-generate logistics.

### 5.14 Crew Chat (per-tour messaging — promoted from open question to a feature)
Real-time crew chat, **scoped to a tour** (like Blue Seal's job-bounded chat — lift that engine, don't rebuild a messenger):
- **Tour channel** (everyone) + **role/group channels** (e.g. "Production", "Bus 1" via Group Tags) + optional 1:1 DMs.
- Realtime via Firestore listeners; **FCM push** on new message (reuse Blue Seal's chat + notifications infra); **offline** send queues and syncs.
- **SMS fallback** (copy GroupMe) via Blue Seal's existing SMS util, so a non-app crew member still gets the "lobby call in 10" ping.
- Messages respect tour **visibility**; attachments reuse the Files storage-scoping.
This resolves old open-question #7 in favour of building chat in — the research showed no purpose-built crew-comms winner exists, and owning the *official* channel (vs. the informal WhatsApp group) is the connective tissue.

### 5.15 Offline-first (a real engineering investment — bigger than Blue Seal's PWA)
Blue Seal's PWA is shell-cache only. Loadout needs **offline read of the active tour's data** (Firestore `persistentLocalCache` / IndexedDB persistence + offline-aware UI states + a "last synced" indicator + queued writes for `manager`+ edits). This is a Phase-in-its-own-right, not a polish step.

---

## 6. Data Model (Firestore)

> Mirrors Blue Seal's `design.md §6` style: collection-by-collection, doc-id conventions, denormalization rules, storage paths. All interfaces live in `src/firebase/interfaces.ts`; all services are pure async functions in `src/firebase/services/`.

### 6.1 The spine (verified from Master Tour's structure)

```
users/{uid}                         [KEEP from Blue Seal — add tourIds[] denormalized for "my tours"]

tours/{tourId}
  - name, artistName, startDate, endDate, ownerUid
  - memberUids: string[]            ← denormalized for cheap rule reads (see §7.1)
  - status, coverImagePath, timezoneDefault
  tours/{tourId}/members/{uid}      ← the membership doc: { role, guestlistPerm, addedBy, addedAt }
  tours/{tourId}/days/{dayId}
     - date, dayType, city, country, timezone, venueId?, notes, confirmed
     tours/{tourId}/days/{dayId}/scheduleItems/{itemId}   { title, start, end, details, visibility, reminder, confirmed }
     tours/{tourId}/days/{dayId}/travelItems/{itemId}     { kind: air|ground|hotel, travellerUids[], visibility, confirmed,
                                                            air:    { airline, flightNo, dep, arr, gate, status, providerRef, lastSyncedAt },
                                                            hotel:  { placeId, name, address, geo, checkIn, checkOut, confirmationNo, nightlyRate, rooming[] },
                                                            ground: { fromPlaceId, toPlaceId, driveMins, distanceKm, depTz, arrTz } }
     tours/{tourId}/days/{dayId}/events/{eventId}
        - venueId, promoterId, production{}, laborCall, visibility
        tours/.../events/{eventId}/guestList/{entryId}    { name, affiliation, passType, count, status, requestedBy }
        tours/.../events/{eventId}/guestAllotments/{type} { passType, numAllowed, enforced, cutoffAt, locked }
        tours/.../events/{eventId}/setList/{songId}       { title, order, guestPerformers, techNotes, notes }
        tours/.../events/{eventId}/settlement/summary     { currency, capacity, ticketsSold, comps, merch, lines[], notes }  ← accountant-gated
        tours/.../events/{eventId}/advance/checklist      { sections[], status }
  tours/{tourId}/personnel/{personId}   { userId?|contactId?, role, perDiem, busDetail, radioDetail, visibility }
  tours/{tourId}/files/{fileId}         { name, storagePath, visibility, uploadedBy }
  tours/{tourId}/notifications/...      [reuse Blue Seal notifications, tour-scoped]

  // Budget (§5.9) — accountant-gated:
  tours/{tourId}/budget/summary                    { byCategory{}, byLeg{}, projectedTotal, actualTotal, variance }  ← denormalized rollup, Fn-maintained
  tours/{tourId}/budget/lines/{lineId}             { category, label, projected, actual, source: manual|hotel|flight|perdiem|settlement, sourceRef }

  // Crew chat (§5.14) — reuse Blue Seal chats/messages, tour-scoped:
  tours/{tourId}/channels/{channelId}              { name, kind: tour|group|dm, memberUids[], visibility }
  tours/{tourId}/channels/{channelId}/messages/{messageId}  { authorUid, body, attachments[], createdAt }

// Cross-tour shared databases (top-level, FK-referenced, NOT embedded):
venues/{venueId}   { name, placeId, address, geo(geohash), phone, website, hours, photos[], googleRating,   // ← Places-sourced
                     capacity, keyContacts[], productionSpecs, claimedByUid?, businessProfileLinked? }        // ← our proprietary layer
contacts/{contactId}  { name, company, phone, email, placeId?, ownerUid | orgId, vcardImport? }
```

### 6.2 Denormalization rules
- `tours/{tourId}.memberUids: string[]` — mirror of the members subcollection, kept in sync by a Cloud Function trigger on member add/remove. **Enables cheap `uid in resource.data.memberUids` rule checks** without a per-read `get()`.
- `users/{uid}.tourIds: string[]` — for the "my tours" list query.
- Day carries a denormalized `venueName`/`city` snapshot for offline day-sheet render even if the venue doc isn't cached.

### 6.3 KEEP-as-is collections (lift from Blue Seal generic infra)
`users`, `notifications`, `chats`/`messages` (repurpose as per-tour crew chat — bounded like Blue Seal's job chat), `auditLog`, `errorLogs`, `qaChecklist`, `mail`/`sms`, `rateLimits`, `webhookEvents`, `platformStats`.

### 6.4 Storage paths (reuse Blue Seal's scoping discipline)
```
tours/{tourId}/files/{uploaderUid}/{fileId}     ← uploader-uid-prefixed, like Blue Seal jobPosts photos
tours/{tourId}/daysheets/{dayId}/{generatedPdf}
venues/{venueId}/specs/{fileId}
```

---

## 7. Security Rules — Key Principles

### 7.1 ⚠️ The one deliberate deviation from Blue Seal (flag in every relevant commit)

Blue Seal's `CLAUDE.md` mandates: *"Role checks via custom claims — never doc lookups."* **That rule assumes global roles. Loadout is multi-tenant, so it cannot hold.** A user's role is *per-tour*, and custom claims can't scale to "role in each of N tours" (claim size limits, staleness). The adaptation:

- **Read hot-path (cheap, no lookup):** membership is checked via the denormalized array — `allow read: if request.auth.uid in resource.data.memberUids`. One document read, no extra `get()`.
- **Write / role-gated path (one lookup):** for edits and financial access, do a single `get(/databases/$(db)/documents/tours/$(tourId)/members/$(uid))` and check `.role`. This is a **justified, contained** use of a rules `get()` — documented here and in a comment at the top of `firestore.rules`.
- **Platform `admin`/`qa`** still use custom claims exactly as Blue Seal does.

This is exactly the kind of "push back when a doc contradicts reality" the CLAUDE.md asks for — the deviation is intentional and localized, not convention drift.

### 7.2 Otherwise unchanged Blue Seal principles
Default-deny; every collection gets explicit read/create/update/delete; every rule gets an allow **and** a deny test in `tests/rules/`; financials (`settlement`) require `accountant`/`owner` membership; per-item `visibility` enforced in rules for `crew`.

### 7.3 Rules helpers to add
`isTourMember(tourId)`, `tourRole(tourId)`, `isTourManager(tourId)`, `isTourAccountant(tourId)`, `canSeeItem(item)` — on top of Blue Seal's kept `isSignedIn`/`uid`/`isAdmin`/`hasRole`.

---

## 8. Cloud Functions

Reuse Blue Seal's callable pattern **verbatim** (App Check enforced, Zod input, structured logging, `HttpsError` conversion, `functions/src/lib/callable.ts`). New domains:

- `functions/src/tours/` — `createTour`, `addTourMember` (+ maintains `memberUids`/`tourIds` denorm), `removeTourMember`, `setMemberRole`, `cascadeDayDateChange` (marks items unconfirmed).
- `functions/src/invites/` — `createInviteLink`, `acceptInvite` (lift Blue Seal's roster-invite/one-tap-invite functions).
- `functions/src/notify/` — `pushTourUpdate` (fan-out to member FCM tokens), reminder scheduler. Reuse Blue Seal `notify`/`messaging`.
- `functions/src/travel/` — `refreshFlightStatus` (FlightAware AeroAPI; scheduled + on-demand), `computeGroundRoute` (Directions/Routes API). All provider calls are **server-side only** — keys never reach the client; responses cached into the travel-item doc for offline.
- `functions/src/places/` — `placesAutocomplete` + `placeDetails` (thin server proxy to **Places API (New)**; keeps the key server-side, lets us cache + rate-limit + dedupe into the `venues`/`contacts` collections). `linkBusinessProfile` (venue-claim via **Google Business Profile API**, v1.1+).
- `functions/src/budget/` — `recomputeBudgetRollup` (Firestore trigger on budget line / hotel / flight / per-diem / settlement change → updates `budget/summary`), `exportBudget` (PDF/CSV).
- `functions/src/settlement/` — `exportSettlement` (PDF/CSV), `recomputePnl` (posts actuals up into the budget).
- `functions/src/chat/` — reuse Blue Seal chat: `onMessageCreate` (FCM fan-out + SMS fallback), channel provisioning. (§5.14)
- `functions/src/daysheets/` — `generateDaySheetPdf` (reuse `jspdf` server or client).
- `functions/src/ai/` — `aiChat` grounded in tour data (RAG over Firestore), `ingestDocument` (parse forwarded confirmation / rider PDF → structured line items). **Stack: Firebase AI Logic / Vertex AI (Gemini), optionally via Genkit** — App Check-protected, billed on the same GCP project (§16).
- **KEEP verbatim:** `functions/src/{auth,lib,admin,diagnostics,stats,support,qa,seed}` (seed rewritten for tour demo data).
- **DROP:** `functions/src/{vetting,insurance,invoicing,jobs,jobPosts,reviews,vouches,prospects,projectManager,projects,sales,billing,payments}` (payments returns only if/when you add Stripe billing in §12).

---

## 9. PWA Requirements

- **Reuse Blue Seal's entire PWA + version-update system** (`vite-plugin-pwa`/Workbox, `registerType:"prompt"`, the custom version-manifest plugin + `useAppUpdate.ts` + `AppUpdatePrompt.vue`, FCM SW, install prompt). Rebrand manifest name/icons/colors only.
- **Upgrade offline from shell-cache to data-cache** (§5.14): Firestore `persistentLocalCache`, offline-aware UI, "last synced" indicator, queued `manager` writes. **This is the single biggest net-new engineering effort vs. Blue Seal** and is why offline gets its own phase.
- FCM push types: schedule change, travel change, guest-list decision, day-sheet published, custom TM broadcast.

---

## 10. Build Phases

> Dependency-ordered, mirroring `design.md §10`. Each ends with the CLAUDE.md verify gates + Help/QA upkeep + deploy-before-commit discipline. Estimates assume Claude Code carrying implementation.

**Phase 0 — Fork & rebrand the scaffolding (1 day)**
Clone the Blue Seal repo into a new project; strip the Blue Seal domain (see §13 map); rebrand manifest/theme/naming to Loadout; wire a fresh Firebase project; confirm `lint && build && test:run` green on the emptied shell. Auth, router-guard system, app shell, PWA, admin, Help Center, QA toolkit, notifications all survive.

**Phase 1 — Multi-tenant foundation (2–3 days)**
The new-vs-Blue-Seal core. Membership model (`tours/{id}/members`), the two-layer role system, the `firestore.rules` deviation (§7.1) with full allow/deny tests, `memberUids`/`tourIds` denorm triggers, "my tours" dashboard, create-tour + invite-link + accept-invite. **Everything downstream depends on this — do not rush it.**

**Phase 2 — Tour spine: Days + Schedule (2–3 days)**
Tour → Days (bulk-create from range, day types, TZ), per-Day schedule items with visibility/reminders/confirmed. Mobile-first day dashboard (crew read) + manager edit. 375px is the design target — a crew member's phone.

**Phase 3 — Venues, Contacts, Personnel + Google Places (2–3 days)**
The three shared DBs, **Places-backed**. Stand up the `places/` server proxy (Autocomplete + Details), venue lookup → auto-fill (address/geo/phone/hours/photos/rating + `placeId`) with the touring-specific fields (capacity/production/contacts) layered on; `.vcf` contact import; tour personnel with per-diem/bus/radio + roles. Reuse Blue Seal geohash/Maps. Add Places/Maps hosts to the CSP (§16).

**Phase 4 — Events, Guest Lists, Set Lists (2–3 days)**
Multi-event days, per-event guest list (allotments + enforced cap + request/approve + cutoff/lock), set lists with notes.

**Phase 5 — Travel & Logistics: Flights + Accommodations (3 days)**
Flights via **FlightAware AeroAPI** (`refreshFlightStatus`, scheduled + on-demand, cached for offline) + the flight-grid view; **hotels via Places** (auto-fill + rooming list); **ground via Directions/Routes** (auto drive-time/distance/TZ, overdrive flag). Per-traveller, visibility-aware.

**Phase 6 — Advancing + Day Sheets (2–3 days)**
Advance checklist/templates + status pipeline; day-sheet template gallery → PDF (reuse jsPDF); multi-day tour book; CSV exports.

**Phase 7 — Offline-first (2–3 days, its own phase)**
Firestore persistent cache, offline UI states, "last synced", queued writes, offline day-sheet render. Test in airplane mode on a real device. (All Places/flight data already cached server-side into docs, so it survives offline.)

**Phase 8 — Budget, Settlements & Tour Finance (3 days)**
Tour **budget** (projected vs actual, category/leg rollups via `recomputeBudgetRollup`, auto-fed from hotels/flights/per-diems), per-event settlement → P/L, accountant gate, QuickBooks/Xero CSV export. Money seams get QA happy-paths (like Blue Seal's money-path QA).

**Phase 9 — Crew Chat + Notifications + real-time (2–3 days)**
Per-tour **chat** channels (tour/group/DM) on Blue Seal's chat engine, FCM fan-out + SMS fallback; TM broadcast push, per-item reminders, change fan-out, unconfirmed-cascade.

**Phase 10 — AI: ingestion + grounded assistant (2–3 days)**
**Firebase AI Logic / Vertex (Gemini)** via Cloud Functions: `ingestDocument` (forward-a-PDF → structured line items — the table-stakes feature), then the grounded `aiChat` (day-sheet drafting, routing/budget Q&A, ask-the-tour). Paid-tier gated, App Check-protected.

**Phase 11 — Launch readiness (1–2 days)**
Sentry, analytics, Master Tour **CSV importer** (the acquisition wedge — competitors lead with "import your Master Tour data"), e2e smoke across roles, install-prompt polish.

**Rough total: ~5–6 weeks** of focused build (vs. Blue Seal's ~3 weeks — the multi-tenant model, real offline, and the flights/Places/budget/chat/AI integrations are the added cost).

---

## 11. Competitive Landscape & Positioning

### 11.1 Where each player sits (the lifecycle map)

The live-music software market splits by **lifecycle stage** and **buyer side**:

```
DISCOVERY/PROMOTION → BOOKING/DEAL → PRODUCTION/TOUR-OPS → PERFORMANCE(on-stage)
Bandsintown            Gigwell        ★ MASTER TOUR ★        BandHelper/OnSong
Songkick/Tourbook      Prism.fm       Roadbook/RoadOps        setlist.fm
                       Muzeek         Advance With Me         StagePlot tools
                       Overture       TourDeck / The Advance
                       Stagent        Artist Growth (+finance)
                       Opendate       J.SHOW
```
**Loadout competes in PRODUCTION/TOUR-OPS** — Master Tour's lane. Everything left of it (booking) and right of it (on-stage) is a **complement/integration target**, not a competitor.

### 11.2 Direct competitors (production/tour-ops)

| Product | Target | Platform | Offline | Pricing | Note |
| --- | --- | --- | --- | --- | --- |
| **Master Tour** (benchmark) | TM/PM + crew | Desktop build + mobile consume | ✅ (auto) | $64.99/yr-billed, $74.99 mo; free crew | Incumbent; aging desktop-centric UX; **no AI**. Raised **$5M Dec 2024** (not acquired, ~$2.5M ARR); building **"Venue Tech Packs"** (200+ standardized venue-advance fields) as a data moat. |
| **RoadOps** (roadops.app) | Touring teams | **Offline-first edit**, mobile/iPad/Mac/web | ✅ | team-size sub (not per-admin); 1st mo free | ⭐ **The sharpest analog to this build.** Built by Master Tour's **ex-lead-developer / VP-Engineering (2016–22)**. Leads with offline-first editing, **"Master Tour import"**, AI intake (forward a confirmation → schedule), read-receipt broadcasts. No settlement yet. |
| **Daysheets** (daysheets.com) | TMs, artists, production | Web + iOS/Android | sync-first | **Free/Plus/Pro/Teams** (numbers not public) | VC-backed (Argon, Two Lanterns); "Daysheets 2.0" rebuild; **AI travel import**, **Flight Grid**, **Group Tags**, real free tier. Eventric runs an attack page against it → its most-feared challenger. |
| **Advance With Me** | Touring + venues | Web | — | Free tier; seats ~$50–65/mo | Pure-play advancing + **AI intake**; seat-based |
| **TourDeck** | Working musicians | Web + mobile | — | pre-launch waitlist | "All-in-one for the road"; one-click advance |
| **Artist Growth** | Managers/labels/agencies | Web + mobile | — | contact-sales (enterprise) | Up-market; tour + finance + touring-capital |
| **J.SHOW** | Agencies + artists (EU) | Web | — | €199–499/yr | All-in-one incl. settlement; per-artist seat |
| **GigSheets / DaySync / My Tour Book** | Indie bands/TMs | Web + mobile | varies | free–low tiers | Down-market, simpler; My Tour Book is free |
| **BandHelper** | DIY bands/solo | Web + native | ✅ full offline | ~$4–12/mo by band size | Indie end; performance-centric (set lists), light tour-ops |

### 11.3 Adjacent — integrate, don't compete
- **Booking/deal (upstream):** Gigwell ($49 artist / $99+ agency), Prism.fm (venue side, contact-sales), Muzeek (free Lite / $9–99/user), Overture (~$1,210/yr), Stagent (€99–799/mo), Opendate (venue+ticketing, $99+/mo). Pull hold/offer/deal data **in**; don't rebuild booking.
- **Ticketing/guest (day-of):** DICE Access, See Tickets, Eventbrite Organizer — **data-in targets** for ticket counts/comps → settlement. Don't build a ticketing platform.
- **On-stage:** setlist.fm (API, commercial license), OnSong/BandHelper/MultiTracks, StagePlot Guru/Ridermaker — embed a **lite stage-plot generator** in the advance; otherwise leave the stage to these.
- **Finance:** QuickBooks/Xero/Wave + spreadsheets are the **real incumbent to displace** — the settlement→accounting CSV export is the switch wedge.

### 11.4 Master Tour's moat (things competitors mostly *don't* have)
1. **Network-effect shared databases** (150k+ venues/crew already populated — instant type-ahead).
2. **Free-crew mobile distribution** (adoption driver).
3. **Genuinely offline-first**, battle-tested.
4. **Incumbency + trust** (Beyoncé/Sabrina Carpenter-tier tours).

### 11.5 Where a clone wins (the opportunities — build these deliberately)
1. **Mobile-first *building*, not just consuming** — kill the desktop dependency. Master Tour's v7 mobile redesign drew concrete backlash in app-store reviews: "doesn't open to the current day," "can't swipe between days," "too much tapping," crashes, can't open attachments (Android 4.21★). These are literal, fixable UX wins.
2. **AI document ingestion — now the price of entry, not a bonus.** Every 2024–26 entrant (RoadOps, Daysheets AI Import, DaySync, Advance With Me, Toursmart) leads with "forward a confirmation / drop a PDF → structured schedule/travel/advance." **Master Tour ships none.** A clone without it reads as legacy on arrival — so build it in Phase 10, and push past parity toward the *frontier* (agentic routing checks, auto-advance drafting, ask-the-tour) that only Music Mogul AI / Toursmart are gesturing at.
3. **Modern, reliable UX + clean data migration** — reliability and fast attachments are table stakes the incumbent is currently *failing*; that's the opening.
4. **Two-way calendar sync + QuickBooks/Xero export + a public API** — Master Tour is CSV-export-only, one-way iCal, no API.
5. **An indie/per-tour tier** — Master Tour's flat ~$65–75/mo ignores the one-off-tour / small-act segment (where BandHelper ~$8/mo and free My Tour Book already play). A two-tier product (cheap indie / full pro) covers both ends.
6. **A first-class Master Tour importer** — RoadOps and others already treat "import your Master Tour data" as a proven acquisition lever; lock-in frustration is real.

**Reality check on the competitive window:** the incumbent is no longer asleep — Eventric took **$5M in Dec 2024** and is building a **venue-data moat** (Venue Tech Packs), and a well-funded challenger (**Daysheets**, VC-backed, on its 2.0 rebuild) plus the incumbent's **own ex-VP-of-Engineering (RoadOps)** are already executing on exactly the mobile-first/offline-first/AI thesis above. This is a **crowded, actively-contested** category, not open water. The defensible bet is the **whitespace no single player nails today: a modern, AI-native, offline-first app that unifies day-of-show *execution* with *advancing* AND *settlement*** — the booking/agency tools (Prism/Gigwell/Stagent/Muzeek) own settlement but not execution; the execution challengers (RoadOps/Daysheets) are thin on settlement. Own all three.

---

## 12. Monetization

**Copy the proven core, add the missing tier.** (Full model belongs in a `MONETIZATION.md`, like Blue Seal — keep help copy qualitative until pricing is live.)

- **Charge builder seats; crew ride free forever.** (`owner`/`manager`/`accountant` are paid; `crew` free.) This is *the* adoption mechanic.
- **Tiers (proposal — validate before shipping):**
  - **Indie** — 1 builder seat, 1 active tour, free crew, core features, no AI. Cheap or freemium. *(The segment Master Tour ignores.)*
  - **Pro** — multiple builder seats, unlimited tours, **AI assistant + AI ingestion**, **tour budget**, **crew chat**, settlement + exports, **flights/hotels/route integrations**. Anchor near/under Master Tour's ~$65–75/mo/builder.
  - **Agency/Enterprise** — many tours/artists, roster view, API, SSO, priced per-seat or per-agency (benchmark: Stagent €99–799/mo, J.SHOW €499/yr/agency).
- **Watch the COGS.** The Google (Places/Directions/Maps), FlightAware, and Vertex-AI calls are **per-request costs** that scale with usage — real gross-margin pressure the pure-SaaS competitors without AI don't carry. Mitigations are already in the design: server-side proxy + **Firestore caching** (repeat lookups are free), App Check + rate limits, and **gating AI/flights behind the Pro tier** so heavy usage correlates with revenue. Track per-tour API spend from day one.
- **Billing infra:** Blue Seal already has Stripe SDK + a payments-handler pattern — reuse when you turn billing on (Phase 12+, out of MVP scope).
- **Do NOT** take a cut of settlements or ticketing — that's not the business; keep it a SaaS subscription.

---

## 13. Scaffolding Reuse Map — KEEP vs REPLACE

> First-hand analysis of the Blue Seal repo. This is the fork checklist for Phase 0.

### ✅ KEEP — generic infra (rename/rebrand only)
- **Build/config/PWA:** `vite.config.ts` (Vite+Tailwind+VitePWA+version-manifest plugin), `src/firebase/config.ts` (App Check, emulator wiring, analytics guard), `firebase.json` security headers, `functions/src/lib/callable.ts`, PWA assets (`manifest.json`, FCM SW, `offline.html`, icons), `useAppUpdate.ts`/`AppUpdatePrompt.vue`/`appVersion.ts`.
- **Auth/roles machinery (the crown jewel):** `src/stores/auth.ts` (multi-account, activeRole, magic-link/Google/custom-token, orphan self-heal, GDPR soft-delete), `functions/src/auth/*` (provision, claims trigger, branded mail, data export/delete), `functions/src/lib/*` (auth, admin, rateLimit, mail, notify, sms, slug, signature), `src/data/roleViews.ts`, `src/components/shell/*` (AppShell, BottomNav, RoleSwitcher, ProfileMenu, SidePanel, NotificationsButton), `src/views/auth/*`, `DashboardEntry.vue`. **→ Swap the role enum to the two-layer model (§3); keep `admin`/`qa` verbatim.**
- **Routing:** `src/router/index.ts` guard/layout system (`requiresAuth`/`role`/`layout`) — keep mechanism, replace route table.
- **Theming:** `src/theme/preset.ts` + `main.css` (PrimeVue `definePreset` + CSS-var tokens) — keep technique, swap ramps.
- **Meta-systems (high value):** Help Center (`src/data/help.ts` + engine), QA toolkit (`src/data/qaChecklist.ts` + `/qa` + `functions/src/qa/*`), Notifications (store + service + FCM + panels), SEO/SSG (`src/seo/*`, `prerender.ts`), Admin scaffolding (`src/views/admin/` shell, user-management + support-desk + `auditLog`/`errorLogs`), generic utils (`slug`, `csv`, `download`, `image`, `format`, `renderMarkdown`, `pdfRender`, `geohash`, `analytics`), form/UX composables + components (`useFormErrors`, `useConfirmAction`, `useToast`, `usePdfDocument`, `useGoogleMaps`, `FieldError`, `LoadingState`, `LocationPicker`, `CalendarView`, `SignatureCanvas`, etc.), Legal doc scaffolding.

### ❌ REPLACE — Blue Seal domain (rebuild for touring)
- **Drop collections/services/rules/interfaces:** `jobs`(+subs), `jobPosts`(+applications), `tradespeople`(+certs), `certifications`, `idVerifications`, `insuranceVerifications`, `wsibVerifications`, `intakeFormSchemas`, `quotes`, `invoices`, `reviews`/`clientReviews`, `disputes`, `bookings`, `clients`/`properties`/`projects`/`projectManagers`, `vouches`, `prospects`, `rosterInvites`, `referrals`, `commissions`/`payouts`, `savedTradies`, `rebatePrograms`, `regions`, `catalog`.
- **Drop functions:** `functions/src/{vetting,insurance,invoicing,jobs,jobPosts,reviews,vouches,prospects,projectManager,projects,sales,billing,payments}`.
- **Drop UI/data/validation:** all job/quote/invoice/insurance/cert/tradie/prospect/sales/pitch/manage components + views; `src/data/{trades,certifications,cities,intakeSchemas,...}`; `src/validation/{clients,properties,projects,...}`; `src/projectManager/`, `src/sales/`.
- **Auth roles to rewire** (edit together): `Role` type in `interfaces.ts`, claim mirroring in `functions/src/auth/*`, rules helpers, `rolesFromClaims()` in `auth.ts`, `roleViews.ts`. **But note:** Loadout's real role logic moves to per-tour membership docs (§3, §7.1) — claims only carry `admin`/`qa`.

---

## 14. What Loadout is NOT (sanity-check list)

- **Not a booking/deal tool** — no offer sheets, holds, or contracts at MVP (that's Gigwell/Prism/Muzeek's lane; integrate later).
- **Not a ticketing platform** — pull counts/comps in; don't sell tickets (that's DICE/See/Eventbrite).
- **Not an on-stage performance app** — no teleprompter/backing tracks/MIDI (that's OnSong/BandHelper/MultiTracks).
- **Not a fan-facing discovery/promotion product** — no public tour pages for fans at MVP (that's Bandsintown/Songkick).
- **Not a general-ledger accountant** — settlement + CSV export to QuickBooks/Xero, not a replacement for them.
- **Not a native app** — PWA only (but offline-first is non-negotiable).
- **Not desktop-first** — the differentiator is full capability on mobile.

If you find yourself building any of the above, stop and ask.

---

## 15. Open Questions

1. **Product name** — Loadout is a codename. Decide before Phase 0 (slug/manifest/theme depend on it).
2. **Org vs. tour as the tenancy unit** — Master Tour uses **Organizations** that own many tours + shared permissions. This plan models tenancy at the **tour** level for MVP simplicity (a tour = a tenant). If you expect agencies managing many artists/tours with shared crew and shared permissions, add an **Org** layer above Tour now (it's much cheaper before Phase 1 than after). **Recommendation: ship tour-level tenancy for MVP; design the membership doc so an `orgId` can be layered in later.** — *needs your call.*
3. **Legs** — Master Tour has no explicit "Leg" entity; routing derives from event locations. Model legs as a UI grouping/filter over date ranges, not a stored entity, unless you want per-leg budgets. *(Default: UI-only.)*
4. **Flight/route data provider** — FlightAware (Master Tour's choice) vs. alternatives; Google Maps for drive-time (already in the stack). *Needs an API-key/cost decision (→ HUMANTASKS).*
5. **setlist.fm integration** — nice-to-have; requires a **commercial license negotiation** (free tier is non-commercial). Defer past MVP.
6. **Pricing specifics** — the exact indie-tier price and the Master Tour anchor need a browser check + a monetization pass before any help copy commits to numbers.
7. ~~**Crew chat**~~ — **Resolved: in scope.** Building per-tour chat on Blue Seal's chat engine (§5.14, Phase 9).
8. **Google API budget & billing** — Places (New), Directions/Routes, Maps, and (v1.1) Business Profile all bill per-request on GCP. Need the API key(s), billing enabled, and a monthly cap/quota decision (→ HUMANTASKS). Server-side proxy + Firestore caching (§16) is designed to keep this cheap.
9. **AI provider** — plan assumes **Firebase AI Logic / Vertex AI (Gemini)** to stay in-project. If you'd rather use Anthropic/OpenAI, it's the same callable pattern with a different SDK — but Vertex-in-Firebase is the lowest-friction, best-infra-leverage default. *Your call; recommend Gemini via Firebase for v1.*

---

## 16. Platform Integrations & Firebase Infrastructure

> This section answers "leverage all of Firebase + Google's integration." It maps every capability to the specific Firebase service or Google API, and states the **server-side-proxy + cache** discipline that keeps keys safe, costs down, and everything offline-capable.

### 16.1 Firebase infrastructure — what each service does for us
| Need | Firebase service | Notes |
| --- | --- | --- |
| Auth + multi-tenant identity | **Firebase Auth** (+ custom claims for `admin`/`qa`) | Reuse Blue Seal's store verbatim (§13). |
| Realtime tour data + **offline** | **Firestore** with `persistentLocalCache` (IndexedDB) | The offline-first spine (§5.15). Realtime listeners drive live schedule/chat/flight updates. |
| Files (riders, contracts, day-sheet PDFs, venue photos) | **Cloud Storage** | Uploader-uid-scoped paths (§6.4). |
| Server logic / integrations | **Cloud Functions v2** (callable + triggers + scheduled) | All third-party API calls live here — never client-side. App Check enforced. |
| Push | **FCM** | Schedule/travel/guest-list/chat/broadcast (§9). Reuse Blue Seal SW. |
| **AI** | **Firebase AI Logic / Vertex AI (Gemini)**, optionally **Genkit** | In-project, App Check-gated, one GCP bill (§16.4). |
| Scheduled work | **Cloud Scheduler** (via scheduled functions) | Flight-status refresh, overdue-advance nudges, reminder fan-out. |
| Abuse/quota protection | **App Check** + Blue Seal's `rateLimit` | Protects the paid Google/flight/AI calls from being drained. |
| Config/rollout | **Remote Config** (optional) | Feature-flag AI, chat, budget per tier without a deploy. |
| Hosting + CSP | **Firebase Hosting** | Add Google Maps/Places hosts to the CSP (§16.5). |

Optional/consider: **Realtime Database** for chat *presence/typing* (cheaper than Firestore for high-churn ephemeral state); **Firebase Extensions** (e.g. the Gemini/"Multimodal Tasks" extension) to shortcut the AI ingestion function.

### 16.2 Google Places & Maps — "the same integration Google has"
The correct API for **pulling** rich place data is the **Places API (New)** + Maps/Directions — not the Business Profile API. Used across the app via a **server-side proxy** (`functions/src/places/`) so the key stays private, results are cached into our own `venues`/`contacts` docs, and repeat lookups are free:
- **Autocomplete** — venue, hotel, airport, restaurant, hospital/pharmacy search as you type.
- **Place Details** — address, lat/lng (+ our geohash), phone, website, opening hours, **photos**, Google rating; store `placeId` for stable re-fetch.
- **Directions / Routes API** — ground drive-time, distance, and time zones between stops; "overdrive" detection (§5.4).
- **Maps JS + Static Maps** — venue/hotel pins, the tour-route map, day-sheet static map thumbnails. Blue Seal already ships `@googlemaps/js-api-loader` + `useGoogleMaps`.
- **Where it plugs in:** venue creation, hotel lookup, airport pickers, "nearest hospital/pharmacy/parking" on the day sheet, the tour overview map.

### 16.3 Google Business Profile API — the venue-side play (v1.1+, not the primary data source)
Distinct from Places: the **Business Profile API** lets a *business manage its own* Google listing. For us that's the **"claim your venue"** feature — a venue's production team connects their Business Profile to sync verified hours/contact and then maintains their **production pack** in Loadout. That's the parallel to Master Tour's **Venue Tech Packs** moat, and a genuine reason venues opt in. Defer to v1.1; the Places-sourced venue data covers v1.

### 16.4 AI stack (Firebase-native)
- **Runtime:** Cloud Function → **Vertex AI (Gemini)** through **Firebase AI Logic**; keeps auth/billing/App Check in one project, no separate backend. Consider **Genkit** for the multi-step flows (ingestion → structured output; RAG assistant).
- **Ingestion:** Gemini multimodal reads forwarded confirmation emails / rider PDFs / photos → structured schedule/travel/advance line items (table-stakes; §5.13).
- **Assistant:** RAG grounded in the tour's Firestore data; never free-generates logistics. Paid-tier gated.
- **Guardrails:** App Check + rate limits (paid tokens), Zod-validate the model's structured output before writing, log every call.

### 16.5 Cross-cutting: keys, cost, CSP, offline
- **Keys server-side only.** The client never holds the FlightAware / Places / Vertex keys — every call is a Cloud Function. (Exception: the Maps JS browser key, which is domain-restricted.)
- **Cache everything into Firestore.** A flight status, a place detail, a route calc is written onto the owning doc — so it renders **offline** and a repeat view costs zero API calls.
- **CSP additions** (Blue Seal ships a strict CSP in `firebase.json`): allow `*.googleapis.com`, `maps.googleapis.com`, `*.gstatic.com`, `maps.google.com` in `connect-src`/`img-src`/`script-src` as needed. Keep it tight.
- **HUMANTASKS (new key/billing items to append at fork):** GCP billing enabled; **Places API (New)** + **Directions/Routes** + **Maps JS** enabled with a key + monthly quota cap; **FlightAware AeroAPI** account + key; **Vertex AI** enabled in the project; (v1.1) **Business Profile API** access. Each with a spend cap.

---

## Appendix — First actions when you say "go"

1. Confirm the product name (Q1) and tenancy decision (Q2) — these two gate everything.
2. Phase 0: fork + strip + rebrand, green build on the empty shell.
3. Phase 1: the multi-tenant membership model + the `firestore.rules` deviation with full allow/deny tests. Everything else is downstream of getting this right.
