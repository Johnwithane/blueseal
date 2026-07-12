# Loadout — Design & Build Plan

> **Working codename:** **Loadout** (the flight cases that travel with every touring production — swap for the real brand later). A Master Tour–class **tour-management PWA** for the live-music industry, built on the same Vue 3 + Firebase scaffolding as Blue Seal.
>
> **What this doc is:** the equivalent of Blue Seal's `design.md` for a *new* product. It defines *what* Loadout is, the domain data model, the roles, the phased build, the competitive positioning, and exactly what carries over from the Blue Seal scaffolding vs. what gets rebuilt. It deliberately mirrors the Blue Seal `design.md` section skeleton so the same working discipline (`CLAUDE.md`) applies unchanged.
>
> **Source of truth for *how* we build:** the existing `CLAUDE.md` (core principles, per-feature loop, callable/rules/service patterns, deploy discipline, Help Center + QA upkeep). Nothing in this doc overrides it.
>
> **Design bar: stay ~1-to-1 with Blue Seal.** Same Firebase footprint, same account/custom-claims system, same multi-role + `activeRole`, same multi-channel `notify.ts` (in-app + email via the Trigger Email extension + WhatsApp), same `onSchedule` scheduler, same Vertex-Gemini AI in `functions/src/ai/`. The touring domain is modelled on Blue Seal's **`projectManager`-runs-many-clients** pattern: a **tour manager runs many bands** the way a PM runs many properties. When in doubt, do it the way Blue Seal already does it — this doc points at the specific files to copy.

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

> **This maps almost 1-to-1 onto Blue Seal's existing role model — not a new paradigm.** Blue Seal's `projectManager` is a **global custom-claim role that manages many clients/properties/projects**, scoped by ownership fields on the docs (`properties/{id}.projectManagerId == uid()`) and get()-based membership checks in rules. **"A tour manager runs multiple bands" is exactly that pattern.** So Loadout reuses Blue Seal's account system, custom-claims, multi-role + `activeRole` view-switching, and self-serve-role provisioning **verbatim** — we just rename the role enum and add a `Band` entity that a manager owns many of (the way a PM owns many properties). See §7.1 — there is **no new "multi-tenant" mechanism**; it's the same resource-field + get() membership checks Blue Seal already uses for chats/jobPosts/reviewPairs.

### 3.1 The role model (mirrors Blue Seal's `client`/`tradesperson`/`projectManager` exactly)

**Global custom-claim roles** — set by `provisionAccount` (rename Blue Seal's `z.enum([...])`), mirrored to `users/{uid}.roles[]` + `activeRole`, multi-role with implied-role invariants, `admin`/`qa` granted separately. **Same machinery, renamed enum:**

| Blue Seal role | → Loadout role | Self-serve? | Manages many of… (like PM→properties) |
| --- | --- | --- | --- |
| `client` (default) | **`crew`** (default) | ✅ signup | — (is added to tours) |
| `projectManager` | **`tourManager`** | ✅ (`addRoleToSelf`, like PM) | **Bands** → **Tours** they own/manage |
| `client` (owns their jobs) | **`artist`** | ✅ | their own **Band(s)** |
| `admin` | **`admin`** | promoted (CLI/callable) | everything |
| `qa` | **`qa`** | capability claim | unlocks `/qa` only |

Implied roles mirror Blue Seal (`tradesperson ⇒ client`): here `tourManager ⇒ crew` and `artist ⇒ crew`, so a manager/artist can also just be crew on someone else's tour.

**Per-tour role detail** (who on *this* tour is manager vs. accountant vs. plain crew) is **not a global claim** — it's the tour-membership record, exactly like Blue Seal stamps `projectManagerId`/`invitedContractorIds` on a job. On the tour doc:
- `ownerUid`, `managerUids[]`, `accountantUids[]`, `memberUids[]` (memberUids = union, the read key). Rules check these as **resource-field arrays** (`uid() in resource.data.memberUids`) — the same shape as Blue Seal's `uid() in resource.data.invitedContractorIds`.
- **Accountant** is the gated financial seam (mirrors Master Tour's Accounting split and Blue Seal's explicit money-gating): only `accountantUids`/`ownerUid` read/write settlement + budget.
- Guest-list sub-permissions (`guestlist:submit` vs `guestlist:manage`) layer on a crew membership, same idea as Blue Seal's granular flags.

### 3.2 Visibility (a second, orthogonal axis — also from Master Tour)

Role says *what you can do*; **visibility** says *which items you can see*:
- **Per-tour visibility** — a tour can be restricted to specific members (an opener's crew added late shouldn't see the headliner's full history).
- **Per-item visibility** — an individual schedule item, travel item, hotel, or file attachment can be hidden from selected members (financial docs, surprise-guest logistics).
- **Override:** `owner`/`manager`/`accountant` bypass item visibility. `crew` are subject to it.

Model visibility as a field on each item (`visibility: "all" | { memberUids: string[] }`), enforced in rules and filtered in queries.

### 3.3 Bands, membership & invites (the "manager runs many bands" structure)

- A user creates an account (reuse Blue Seal auth verbatim: email/password, Google, magic link, branded verification email).
- A **`tourManager`** (or `artist`) creates one or more **Bands** (`bands/{bandId}`, `managerUids[]`/`ownerUid`) — the direct analogue of a PM's client roster. Under a Band they create **Tours**. One manager, many bands, many tours — all scoped by the same ownership fields Blue Seal uses for a PM's properties/projects.
- They invite crew by email or **one-tap invite link** (lift Blue Seal's `rosterInvites` + `linkRosterInvitesOnSignup` / `/join?code=` pattern — it already auto-links a roster invite on signup). Invitee is added to `memberUids` (and `managerUids`/`accountantUids` if promoted).
- Crew are **free forever**; only builder seats (`tourManager`/`artist`/accountant memberships) count toward billing (see §12). "Charge the builder, crew ride free" drives org-wide adoption — a TM mandates the app to 40 crew without a per-seat fight.

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

### 5.12 Notifications & Real-time Sync (reuse Blue Seal's exact multi-channel stack)
Custom TM→crew push, per-item reminders, change fan-out — all through Blue Seal's existing `functions/src/lib/notify.ts`, which already routes one notification to **three channels: in-app (`notifications` collection) + email + WhatsApp** (SMS kept as an opt-in fallback). Email goes via **`enqueueMail` → the `mail` collection → the Firebase "Trigger Email" extension**, branded with `emailTemplate.ts` (`brandedEmailHtml`). Reuse the notifications store, `NotificationsPanel`, and FCM SW verbatim; the **only** change is adding tour-scoped entries to the existing `NotificationType` union (e.g. `schedule_changed`, `travel_changed`, `guestlist_decided`, `daysheet_published`, `tour_broadcast`) — exactly how Blue Seal added `pm_welcome`, `invoice_sent`, etc.

### 5.13 AI Assistant & AI Ingestion (literally Blue Seal's `functions/src/ai/` — 1-to-1)
**No new AI stack.** Blue Seal already runs Vertex AI Gemini server-side in Cloud Functions: `@google-cloud/vertexai`, `gemini-2.5-flash`, env `VERTEX_MODEL`/`VERTEX_LOCATION`, lazy per-function client, function-calling **tools** (`ai/tools.ts` + `ai/chatTools.ts`), App Check-gated, with explicit "bail early to save a Vertex call" cost discipline. Loadout reuses that pattern verbatim and even **maps each feature onto an existing Blue Seal AI function to copy**:

| Loadout AI feature | Copy Blue Seal's… | What it does there |
| --- | --- | --- |
| **Document ingestion** (forward a hotel/flight confirmation or rider PDF → structured schedule/travel/advance line items) | **`ai/parseReceipt.ts`** | Gemini multimodal reads an uploaded receipt image/PDF → structured JSON. *Same shape, different schema.* |
| **Grounded assistant** ("what's tonight's load-in / wifi?", scoped to a tour) | **`ai/chat.ts` + `chatTools.ts` + `tools.ts`** | Gemini assistant with function-calling tools grounded in a job's data. |
| **Day-sheet / message drafting** | **`ai/draftQuote.ts` / `draftInvoiceNote.ts` / `suggestReplies.ts`** | Draft structured text from record data. |
| **Tour digest** ("what changed today across my tours") | **`ai/projectsDigest.ts`** | Scheduled cross-entity summary for a manager. |
| **Generate-a-tour-from-a-prompt** | **`ai/generateProjectFromPrompt.ts`** | Turns a freeform prompt into a structured entity. |

Ingestion is table-stakes (every 2024-26 competitor has it); the grounded assistant is the frontier (the incumbent has none). Gate behind the paid builder tier (Blue Seal's paid-AI pattern). Ground every answer in the tour's Firestore data — never free-generate logistics.

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
users/{uid}                         [KEEP from Blue Seal — add roles[]/activeRole (already there), bandIds[]/tourIds[] for "mine"]

bands/{bandId}                      ← the "manager runs many bands" entity (mirrors Blue Seal properties/{id})
  - name, ownerUid, managerUids: string[], createdAt      ← scoped exactly like properties.projectManagerId

tours/{tourId}
  - bandId, name, startDate, endDate
  - ownerUid, managerUids[], accountantUids[], memberUids[]   ← resource-field access keys (like invitedContractorIds)
  - status, coverImagePath, timezoneDefault
  tours/{tourId}/members/{uid}      ← per-tour role detail: { role: manager|accountant|crew, guestlistPerm, addedBy, addedAt }
                                        (the *arrays above* are the fast rule-check mirror, maintained by a Fn trigger)
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
- `tours/{tourId}.{ownerUid,managerUids,accountantUids,memberUids}` — the access-key arrays, mirror of the `members` subcollection, kept in sync by a Cloud Function trigger on member add/remove/role-change. Rules check them as resource fields (`uid() in resource.data.memberUids`) — the same shape as Blue Seal's `invitedContractorIds`.
- `bands/{bandId}.managerUids` + `users/{uid}.{bandIds,tourIds}` — for "my bands / my tours" list queries and band-level access.
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

### 7.1 Membership = the same pattern Blue Seal already uses (NOT a deviation)

Earlier drafts framed per-tour roles as a "deviation" from CLAUDE.md's "prefer custom claims over doc lookups." **That was wrong** — Blue Seal's rules already use `get()`/`exists()` in ~20 places (chats check `get(chats/$(chatId)).data.clientId == uid()`, jobPosts applications, reviewPairs, etc.) **and** resource-field array membership (`uid() in resource.data.get('invitedContractorIds', [])`). Loadout uses those **same two techniques**, so it's consistent with the real codebase, not a departure:

- **Read/most writes (no lookup):** `allow read: if uid() in resource.data.memberUids` — identical to Blue Seal's `uid() in resource.data.invitedContractorIds`. `managerUids`/`accountantUids` gate edits + financials the same way.
- **Where a child doc must consult its parent tour** (e.g. a schedule item under a day), either denormalize the access key onto the child (preferred — a Fn trigger stamps `memberUids`/`tourId`, then it's a resource-field check) **or** `get()` the parent — **exactly how Blue Seal's chat `messages` get() their parent `chat`.** Not novel.
- **Global claims** (`hasRole('tourManager')`, `isAdmin()`, `qa`) gate role-level capability, same as Blue Seal's `hasRole('projectManager')`.

Net: the Band/Tour access model is the `projectManager`→`properties`/`projects`/`jobs` model with different names. No new mechanism, no CLAUDE.md tension.

### 7.2 Otherwise unchanged Blue Seal principles
Default-deny; every collection gets explicit read/create/update/delete; every rule gets an allow **and** a deny test in `tests/rules/`; financials (`settlement`) require `accountant`/`owner` membership; per-item `visibility` enforced in rules for `crew`.

### 7.3 Rules helpers to add
`isTourMember(tourId)`, `tourRole(tourId)`, `isTourManager(tourId)`, `isTourAccountant(tourId)`, `canSeeItem(item)` — on top of Blue Seal's kept `isSignedIn`/`uid`/`isAdmin`/`hasRole`.

---

## 8. Cloud Functions

Reuse Blue Seal's callable pattern **verbatim** (App Check enforced, Zod input, structured logging, `HttpsError` conversion, `functions/src/lib/callable.ts`). New domains:

- `functions/src/tours/` — `createTour`, `addTourMember` (+ maintains `memberUids`/`tourIds` denorm), `removeTourMember`, `setMemberRole`, `cascadeDayDateChange` (marks items unconfirmed).
- `functions/src/invites/` — `createInviteLink`, `acceptInvite` (lift Blue Seal's roster-invite/one-tap-invite functions).
- **Notifications/email — reuse Blue Seal verbatim:** call `lib/notify.ts` (in-app + email + WhatsApp in one call); email flows through `enqueueMail` → `mail` collection → **Trigger Email extension** with `emailTemplate.brandedEmailHtml`. Add tour `NotificationType`s to the existing union. Reminders + flight refresh use **`onSchedule(...)`** (same as Blue Seal's `scheduledOverdue`/`nudgeReviewPairs`).
- `functions/src/travel/` — `refreshFlightStatus` (FlightAware AeroAPI; scheduled + on-demand), `computeGroundRoute` (Directions/Routes API). All provider calls are **server-side only** — keys never reach the client; responses cached into the travel-item doc for offline.
- `functions/src/places/` — `placesAutocomplete` + `placeDetails` (thin server proxy to **Places API (New)**; keeps the key server-side, lets us cache + rate-limit + dedupe into the `venues`/`contacts` collections). `linkBusinessProfile` (venue-claim via **Google Business Profile API**, v1.1+).
- `functions/src/budget/` — `recomputeBudgetRollup` (Firestore trigger on budget line / hotel / flight / per-diem / settlement change → updates `budget/summary`), `exportBudget` (PDF/CSV).
- `functions/src/settlement/` — `exportSettlement` (PDF/CSV), `recomputePnl` (posts actuals up into the budget).
- `functions/src/chat/` — reuse Blue Seal chat: `onMessageCreate` (FCM fan-out + SMS fallback), channel provisioning. (§5.14)
- `functions/src/daysheets/` — `generateDaySheetPdf` (reuse `jspdf` server or client).
- `functions/src/ai/` — **copy Blue Seal's `ai/` folder pattern verbatim** (`@google-cloud/vertexai`, `gemini-2.5-flash`, `VERTEX_MODEL`/`VERTEX_LOCATION` env, lazy client, function-calling tools): `aiChat` (from `ai/chat.ts`+`chatTools.ts`), `ingestDocument` (from `ai/parseReceipt.ts`), `draftDaySheet` (from `ai/draftQuote.ts`), `tourDigest` (from `ai/projectsDigest.ts`). App Check-protected, same GCP project (§16).
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
Clone the Blue Seal repo into a new project; strip the Blue Seal domain (see §13 map); stand up the **modular design-system token layer** (`theme/preset.ts` + `main.css` with neutral placeholder brand — §17); rebrand manifest/naming; wire a fresh Firebase project; confirm `lint && build && test:run` green on the emptied shell. Auth, router-guard system, app shell, PWA, admin, Help Center, QA toolkit, notifications all survive.

**Phase 1 — Bands, Tours & membership (2–3 days) — the PM model, renamed**
Rename Blue Seal's role enum (`client/tradesperson/projectManager` → `crew/artist/tourManager`), keep multi-role + `activeRole` + implied roles + `admin`/`qa` verbatim. Add the **`Band`** entity (owned like `properties`) and **`Tour`** under it, with `ownerUid`/`managerUids`/`accountantUids`/`memberUids` access arrays + a Fn trigger to maintain them, rules using the same resource-field/`get()` membership checks Blue Seal already uses (§7.1), full allow/deny tests, "my bands / my tours" dashboard, create-band/tour + invite-link + accept-invite (lift `rosterInvites`). **Everything downstream depends on this — do not rush it.**

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
**Copy Blue Seal's `functions/src/ai/` (Vertex Gemini)**: `ingestDocument` (clone `parseReceipt.ts` — forward-a-PDF → structured line items, the table-stakes feature), then the grounded `aiChat` (clone `chat.ts`+`chatTools.ts` — day-sheet drafting, routing/budget Q&A, ask-the-tour). Paid-tier gated, App Check-protected.

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
2. **Tenancy** — *Largely resolved by mirroring Blue Seal's PM model:* a **`tourManager` owns many `Bands`, each with many `Tours`** — the exact shape of a `projectManager` owning many `properties`/`projects`. Band is the natural grouping. Only open question: if **agencies** need a shared layer *above* a single manager's bands (multiple managers, shared crew pool, shared billing), add an **`Org`** above Band later — the same way you'd add it above a PM. **Recommendation: Band-level for MVP (no Org); it's the PM pattern you already run.**
3. **Legs** — Master Tour has no explicit "Leg" entity; routing derives from event locations. Model legs as a UI grouping/filter over date ranges, not a stored entity, unless you want per-leg budgets. *(Default: UI-only.)*
4. **Flight/route data provider** — FlightAware (Master Tour's choice) vs. alternatives; Google Maps for drive-time (already in the stack). *Needs an API-key/cost decision (→ HUMANTASKS).*
5. **setlist.fm integration** — nice-to-have; requires a **commercial license negotiation** (free tier is non-commercial). Defer past MVP.
6. **Pricing specifics** — the exact indie-tier price and the Master Tour anchor need a browser check + a monetization pass before any help copy commits to numbers.
7. ~~**Crew chat**~~ — **Resolved: in scope.** Building per-tour chat on Blue Seal's chat engine (§5.14, Phase 9).
8. **Google API budget & billing** — Places (New), Directions/Routes, Maps, and (v1.1) Business Profile all bill per-request on GCP. Need the API key(s), billing enabled, and a monthly cap/quota decision (→ HUMANTASKS). Server-side proxy + Firestore caching (§16) is designed to keep this cheap.
9. ~~**AI provider**~~ — **Resolved: identical to Blue Seal.** `@google-cloud/vertexai` + `gemini-2.5-flash` server-side in Cloud Functions (copy `functions/src/ai/`). No new stack, no Genkit, no Firebase-AI-Logic SDK.

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
| **Email** | **`mail` collection → Firebase "Trigger Email" extension** (via `lib/mail.enqueueMail`), branded by `emailTemplate.ts` | Exactly Blue Seal — one `notify.ts` call fans to in-app + email + WhatsApp. |
| **AI** | **Vertex AI (Gemini) — identical to Blue Seal**: `@google-cloud/vertexai`, `gemini-2.5-flash`, server-side in Cloud Functions | In-project, App Check-gated, one GCP bill. No new stack (§16.4). |
| Scheduled work | **`onSchedule(...)`** (Cloud Scheduler) — as Blue Seal's `scheduledOverdue`/`nudgeReviewPairs` | Flight-status refresh, overdue-advance nudges, reminder fan-out. |
| Abuse/quota protection | **App Check** + Blue Seal's `rateLimit` | Protects the paid Google/flight/AI calls from being drained. |
| Config/rollout | **Remote Config** (optional) | Feature-flag AI, chat, budget per tier without a deploy. |
| Hosting + CSP | **Firebase Hosting** | Add Google Maps/Places hosts to the CSP (§16.5). |

Every row above is a service Blue Seal already uses — this is the same Firebase footprint, not an expanded one. (Optional-only: **Realtime Database** for chat presence/typing if Firestore churn gets expensive — but Blue Seal does chat on Firestore, so default to matching it.)

### 16.2 Google Places & Maps — "the same integration Google has"
The correct API for **pulling** rich place data is the **Places API (New)** + Maps/Directions — not the Business Profile API. Used across the app via a **server-side proxy** (`functions/src/places/`) so the key stays private, results are cached into our own `venues`/`contacts` docs, and repeat lookups are free:
- **Autocomplete** — venue, hotel, airport, restaurant, hospital/pharmacy search as you type.
- **Place Details** — address, lat/lng (+ our geohash), phone, website, opening hours, **photos**, Google rating; store `placeId` for stable re-fetch.
- **Directions / Routes API** — ground drive-time, distance, and time zones between stops; "overdrive" detection (§5.4).
- **Maps JS + Static Maps** — venue/hotel pins, the tour-route map, day-sheet static map thumbnails. Blue Seal already ships `@googlemaps/js-api-loader` + `useGoogleMaps`.
- **Where it plugs in:** venue creation, hotel lookup, airport pickers, "nearest hospital/pharmacy/parking" on the day sheet, the tour overview map.

### 16.3 Google Business Profile API — the venue-side play (v1.1+, not the primary data source)
Distinct from Places: the **Business Profile API** lets a *business manage its own* Google listing. For us that's the **"claim your venue"** feature — a venue's production team connects their Business Profile to sync verified hours/contact and then maintains their **production pack** in Loadout. That's the parallel to Master Tour's **Venue Tech Packs** moat, and a genuine reason venues opt in. Defer to v1.1; the Places-sourced venue data covers v1.

### 16.4 AI stack — copy Blue Seal's `functions/src/ai/` exactly (no new stack)
- **Runtime:** Cloud Function → **`@google-cloud/vertexai`** (`gemini-2.5-flash`, env `VERTEX_MODEL`/`VERTEX_LOCATION`), lazy per-function client, function-calling **tools** — the identical setup already in Blue Seal's `ai/chat.ts`, `ai/parseReceipt.ts`, `ai/tools.ts`. Server-side, App Check-gated, one GCP bill. **No Firebase-AI-Logic SDK, no Genkit — Blue Seal uses neither.**
- **Ingestion:** clone **`ai/parseReceipt.ts`** — Gemini multimodal reads a forwarded confirmation / rider PDF/photo → structured JSON line items (table-stakes; §5.13).
- **Assistant:** clone **`ai/chat.ts` + `chatTools.ts`** — grounded in the tour's Firestore data via function-calling tools; never free-generates logistics. Paid-tier gated.
- **Guardrails (already Blue Seal's discipline):** App Check + `rateLimit`, "bail early to save a Vertex call," Zod-validate the model's structured output before writing, structured-log every call.

### 16.5 Cross-cutting: keys, cost, CSP, offline
- **Keys server-side only.** The client never holds the FlightAware / Places / Vertex keys — every call is a Cloud Function. (Exception: the Maps JS browser key, which is domain-restricted.)
- **Cache everything into Firestore.** A flight status, a place detail, a route calc is written onto the owning doc — so it renders **offline** and a repeat view costs zero API calls.
- **CSP additions** (Blue Seal ships a strict CSP in `firebase.json`): allow `*.googleapis.com`, `maps.googleapis.com`, `*.gstatic.com`, `maps.google.com` in `connect-src`/`img-src`/`script-src` as needed. Keep it tight.
- **HUMANTASKS (new key/billing items to append at fork):** GCP billing enabled; **Places API (New)** + **Directions/Routes** + **Maps JS** enabled with a key + monthly quota cap; **FlightAware AeroAPI** account + key; **Vertex AI** enabled in the project; (v1.1) **Business Profile API** access. Each with a spend cap.

---

## 17. Design System & Theming (modular, PrimeVue-first, brand-swappable)

> Goal: **build almost entirely from PrimeVue components**, driven by a **modular token layer** with **one isolated brand file** you edit later to rebrand — colours, button styles, radii, type — without touching component code. This mirrors Blue Seal's exact setup (`src/theme/preset.ts` + `src/assets/main.css`); we keep the technique and swap the values.

### 17.1 The three layers (edit inward-out; each is independent)
1. **PrimeVue Aura + `definePreset` — `src/theme/preset.ts`.** The component engine. Aura is the base; `definePreset(Aura, {...})` remaps Aura's **primitive ramps** (green/red/amber/blue families that drive every Button/Tag/Message/focus-ring severity) to our brand ramps, and maps `semantic.primary` to the brand primary. **This is why every PrimeVue component inherits the brand for free** — we don't restyle components, we retune the tokens they already read. Use PrimeVue for everything with a component (Button, InputText, Select, DataTable, Dialog, Tag, Stepper, Menu, Toast…). Hand-rolled CSS only where no PrimeVue component fits.
2. **CSS-variable design tokens — `src/assets/main.css` `:root`.** The single source of truth for everything theme-sensitive, as Blue Seal does it, grouped:
   - **Brand palette** (the identity ramps — the thing you swap): `--brand-primary`, `--brand-accent`, plus each ramp 50–950.
   - **Semantic surfaces**: `--bg`, `--surface`, `--text`, `--muted`, `--border`, `--surface-alt`.
   - **Functional semantics** (NOT identity — success/warn/danger/info + `-tint`/`-text` triplets).
   - **Typography**: `--font-body`, `--font-display`, `--font-heading` (+ optional logo/hand).
   - **Shape/depth**: `--radius-sm/md/lg`, `--shadow-sm/md`.
   - **Domain tokens** (the tour equivalent of Blue Seal's `--bs-status-*`): day-type + confirm-state colours — `--day-show`, `--day-travel`, `--day-off`, `--day-press`, `--state-confirmed`, `--state-unconfirmed`. Every day-sheet/kanban/pill reads these, so re-tinting the whole app's status language is one block.
   - `preset.ts` ramps and `main.css` tokens **mirror each other — retune together** (Blue Seal notes this discipline in-file; keep it).
3. **Component conventions (thin, documented).** A short set of rules so the UI reads as one system: primary action = `Button` (primary), destructive = `Button severity="danger"`, subtle = `text`/`outlined`; Tailwind for **layout/spacing only** (per `CLAUDE.md`), tokens for **any colour/type/radius**; never inline a hex. A handful of base wrappers already come from Blue Seal (`FieldError`, `LoadingState`, `TabBar`, `CalendarView`, `InitialsAvatar`) — reuse, don't reinvent.

### 17.2 "Leave space for branding" — how it's isolated
- **Rebranding = editing two files, nothing else:** the ramps in `theme/preset.ts` and the `:root` block in `main.css`. Because components read tokens, a full re-skin is a token swap — no component edits, no regressions. (Same principle as Blue Seal's "swap the six colour ramps.")
- **Ship a neutral placeholder brand now.** Phase 0 lays down a deliberately plain, accessible palette (neutral primary + standard functional colours) so the app looks clean and consistent immediately; drop the real Loadout brand ramps in later by editing that one layer. Nothing downstream depends on the placeholder values.
- **Editable later, safely.** Tokens are CSS vars, so a future "brand settings" surface *could* drive them at runtime — but MVP keeps it a **deliberate code edit** (exactly like Blue Seal treats `help.ts`/`qaChecklist.ts`: reviewed, typed, in-repo), which is the right default until a real theming-admin need appears.
- **Light/dark ready.** Keep Blue Seal's light-first tokens and leave the `prefers-color-scheme` / `[data-theme]` hooks in place so a dark mode is a second token set, not a rewrite.

### 17.3 Where it sits in the build
Phase 0 (fork/rebrand) stands up `theme/preset.ts` + `main.css` with the neutral placeholder tokens and confirms PrimeVue renders through them; every later phase consumes tokens + PrimeVue components only. Accessibility bar: WCAG AA contrast on the placeholder palette (validate when the real brand lands too), 375px-first.

---

## Appendix — First actions when you say "go"

1. Confirm the product name (Q1) and tenancy decision (Q2) — these two gate everything.
2. Phase 0: fork + strip + rebrand, green build on the empty shell.
3. Phase 1: the Bands + Tours + membership model (Blue Seal's `projectManager`→`properties` pattern, renamed) with full allow/deny rules tests. Everything else is downstream of getting this right.
