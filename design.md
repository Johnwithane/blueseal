# Blue Seal — Design Document

> **Companion doc:** `TECH_STACK_SETUP.md` covers environment setup, dependencies, and architecture patterns. This document covers **what to build** (product spec, flows, data model, security, build phases).
>
> **For Claude Code:** Read this whole document before writing any feature code. Setup steps live in `TECH_STACK_SETUP.md` and should be completed first.

---

## 1. Vision

A two-sided progressive web app for trades work.

- **Clients** (people who need work done) browse verified tradespeople near them, view profiles with ratings and availability, and submit job requests with photos and a trade-specific intake form.
- **Tradespeople** build a vetted profile, manage their book of business via a kanban + calendar, chat with clients per job, use the always-on AI assistant to diagnose and quote faster, and get paid via auto-generated invoices.
- **Admins** vet tradespeople (cert + ID), moderate the platform, and run support.

Defining traits: real verification (cert + ID), mutual ratings (both sides build reputation), and AI woven into the daily workflow rather than bolted on.

## 2. Naming

- **Client** — person hiring. ("Client" is the natural term in trades; we don't use "customer.")
- **Tradesperson** / **Tradie** — service provider.
- **Admin** — platform operator (us).

In code, role strings are `"client"`, `"tradesperson"`, `"admin"`.

## 3. User Roles & Auth Tiers

Three tiers gated by Firebase Auth custom claims (`role`).

### 3.1 Client (`role: "client"`)
- Default role on public signup (email/password or Google)
- Browses + filters tradespeople, views profiles with ratings, reviews, availability
- Submits direct requests to a specific tradesperson with photos + trade-specific intake form
- Chats with tradies per job
- Reviews tradespeople publicly after a completed job
- Receives a **private** reputation score from tradies (visible only to other tradies)

### 3.2 Tradesperson (`role: "tradesperson"`)
- Self-selects this role on signup (separate signup flow)
- Required profile: primary trade + up to 3 secondary, years of experience, pricing model (hourly / quote-only / both), service area, weekly availability, bio
- **Required uploads:** at least one trade certification + government-issued photo ID
- Profile is `isVisible: false` until admin approves both cert(s) and ID
- Once live: appears in search, manages jobs via kanban + calendar, sees per-job chat
- Reviews clients privately
- Subscribes (Stripe) to unlock the AI assistant

### 3.3 Admin (`role: "admin"`)
- Cannot self-signup — promoted via `setAdminRole` callable (first admin via Firebase CLI)
- Vets tradespeople (reviews cert + ID side-by-side)
- Moderates jobs, chats; handles support and disputes
- Suspends accounts, hides reviews, processes refunds
- All admin actions are written to `auditLog`

## 4. User Flows

### 4.1 Tradesperson Signup & Vetting

```
Landing → "I'm a trade" CTA
  ↓
Email/password (or Google)
  ↓
Profile basics: display name, photo, phone
  ↓
Trade selection: primary trade + up to 3 secondary (from canonical list)
  ↓
Experience: years in trade, short bio
  ↓
Pricing: hourly rate AND/OR "quotes only" toggle, free-quotes toggle
  ↓
Service area: pin on map + radius slider (km)
  ↓
Weekly availability: drag time blocks per weekday
  ↓
For each trade selected → upload cert:
  - file (PDF or image)
  - issuing body, cert number, expiry date
  ↓
ID verification: upload government-issued photo ID
  ↓
Submit for review → vettingStatus: pending, isVisible: false
  ↓
Admin queue: reviewer sees cert(s) + ID side-by-side
  - Approve all → isVisible: true, verifiedTrades populated, email "You're live"
  - Request changes → vettingStatus: info_requested, email with notes
  - Reject → vettingStatus: rejected, email with reason
  ↓
Live: appears in search
```

Notes:
- Multi-step wizard (PrimeVue Stepper). Each step saves progress to Firestore so the tradie can leave and resume (`vettingStatus: "draft"` during editing).
- ID is stored under a restricted Storage path; only admins can read it. Auto-deleted 90 days after the account is approved (compliance hygiene, via scheduled function).
- v1.1: integrate Stripe Identity for automated ID checks to reduce admin load.

### 4.2 Tradesperson Daily Workflow

Once live, the dashboard becomes home base.

**Layout:** kanban board on top, calendar view toggle.

**Kanban columns:**
1. **Inbox** — new direct requests, unresponded
2. **Quoted** — quote sent, awaiting client decision
3. **Scheduled** — confirmed jobs with a date
4. **In Progress** — work started
5. **Awaiting Payment** — work complete, invoice sent, not paid
6. **Complete** — paid + reviewed (archived after 30 days)

**Each card** shows: client name, job title, location distance, scheduled date (if any), unread message count, status flags. Drag between columns updates status. Moving to **Complete** requires confirmation since it triggers invoice draft.

**Card click → Job Detail panel:**
- Chat thread (text + photos, realtime)
- Original intake form (the structured submission with photos), read-only
- Schedule controls (date/time picker, syncs to calendar)
- Private notes (tradie-only)
- **AI assistant** (subscription-gated; floating bubble bottom-right, slide-in side panel) — sees this job's chat, intake form, and photos as context. Three quick-prompt chips on a fresh job thread pre-fill the composer with templated prompts: **Diagnose** (likely causes, on-site checks, parts to bring), **Quote** (line-item draft in CAD), **Summary** (one-paragraph recap). The user can edit before sending and continue the conversation in the same thread (see §5.9).
- Invoice section (draft auto-created on Complete; editable line items; Send)
- Review prompt (after Complete): rate the client (private)

**Calendar view:** same jobs rendered on a weekly/monthly calendar, overlaid on weekly availability blocks. Drag-resize to reschedule.

### 4.3 Client Discovery & Booking Flow (direct-request)

Direct request to a specific, pre-chosen tradesperson. Coexists with the job-board flow (§4.6) — both feed the same downstream Job + chat pipeline.

```
Sign up (email/password or Google)
  ↓
Search page: map + list, filters (trade, distance, min rating, available this week)
  ↓
Click tradesperson card → profile page:
  - Verified badges, rating breakdown, reviews
  - Bio, experience, pricing, portfolio photos
  - Read-only calendar (free/busy, next 4 weeks)
  - "Request a quote" CTA
  ↓
Request form (route):
  - Generic: title, description, preferred date window, address, urgency
  - Required: ≥ 1 photo of the issue/area
  - Trade-specific fields driven by intake schema:
    - Plumber → fixture type, leak Y/N, water shut off Y/N
    - Electrician → circuit, breaker tripping Y/N, hazard severity
    - HVAC → unit age, symptom, last serviced
    - etc.
  ↓
Submit → creates Job (status: requested), creates Chat thread,
notifies tradesperson (email + in-app)
  ↓
Tradesperson responds in chat (clarify, quote, ask for date)
  ↓
Once date confirmed → Job moves to Scheduled
  ↓
Work happens, tradie marks Complete
  ↓
Invoice sent, client pays (offline for MVP; Stripe Connect in v1.1)
  ↓
Both parties prompted to review
```

### 4.4 Mutual Review Flow

After a job moves to `Complete`:

```
Both parties see a "Leave a review" prompt
  ↓
Client → reviews tradie publicly (1–5 stars + text + dimension scores)
  Dimensions: quality, punctuality, communication, value
  Shows on tradie profile; contributes to ratingAvg
  ↓
Tradie → reviews client privately (1–5 stars + text + category scores)
  Categories: punctuality, communication, clarity, payment
  Visible only to other tradies considering work from this client
  Contributes to client's clientRatingAvg
  ↓
14-day window. After that, the job auto-closes with no review.
  ↓
Either party can dispute a review with admin (admin can hide pending investigation).
```

### 4.5 Admin Vetting Flow

```
Admin dashboard → Pending queue (sorted by submittedAt asc)
  ↓
Click application → detail view:
  - Tradie profile preview
  - All cert uploads (zoomable)
  - ID upload (zoomable, watermarked "ADMIN VIEW ONLY")
  - Name match indicator (auto-compares name across docs)
  ↓
Three actions:
  - Approve all → vettingStatus: approved, isVisible: true, welcome email
  - Request info (with notes) → vettingStatus: info_requested
  - Reject (with reason) → vettingStatus: rejected, 30-day cooldown before reapply
  ↓
Every action writes to auditLog (actor, action, target, reason, timestamp)
```

Target SLA: 1–2 business days. Dashboard shows queue depth + oldest pending age.

### 4.6 Job-Board Marketplace (added in Phase 5b)

A second client entry path, in addition to §4.3's direct request. Lets clients who don't have a specific tradesperson in mind post an open job, compare **full itemized quotes** from verified tradies in their area, and accept one. Both flows converge on the same `jobs/{jobId}` doc and from that point the workflow is identical.

```
Landing page → "Post a job, get bids" CTA (no auth required to start)
  ↓
PostJobView form (trade, title, description, **trade-specific questionnaire**,
  photos ≥1, budget min/max CAD, address with Google Places autocomplete,
  urgency, preferred date window). Once a trade is chosen, its questionnaire
  (src/data/intakeSchemas.ts → IntakeFormRenderer) renders inline; required
  fields gate submission. Draft (incl. answers) persists to localStorage.
  ↓
Submit:
  - If unauthed: stash draft, redirect to /sign-in?redirect=/jobs/post
    (form re-hydrates on return).
  - If authed: upload photos to jobPosts/{tempUuid}/photos/ (WebP-only),
    then call createJobPost callable.
  ↓
createJobPost (callable):
  - Enforces 5 open posts per client cap.
  - Derives geohashExact (length 9) + geohashPublic (length 6, ~1.2km cell)
    server-side from the lat/lng.
  - Writes parent jobPosts/{postId} (public-ish fields only, incl. the
    trade-specific intakeFormData answers — bounded/re-validated server-side)
    + private/meta subdoc (exact address, applicationCount, selectedApplicantId).
  - Sets expiresAt = now + 30d.
  ↓
Verified tradies (isVisible:true) see the post at /jobs/browse:
  - Realtime feed bounded by tradie's location + radius (default 25 km) +
    optional trade filter (default = tradie's primary trade).
  - Posts the tradie has already applied to are filtered out.
  - Address shown to tradies: city + region + first 3 chars of postal code
    (FSA). Exact address never leaves /private/meta until acceptance.
  ↓
Tradie applies via submitApplication callable:
  - Vetted (isVisible:true) tradies only.
  - One application per tradie per post (rules-enforced via doc id = uid).
  - Daily rate limit: 10 applications per tradie per 24h.
  - Cover message ≥ 20 chars + a **full itemized quote** (line items, taxes,
    optional discount + upfront fee). Totals + the upfront-fee cents are
    recomputed server-side (shared lib/quoteTotals.ts); a one-line
    proposedPrice summary { type:"fixed", amount: total } is derived from it
    so list/notification rendering is unchanged. The quote is stored on the
    application doc (ApplicationQuote).
  - Bid-blind: tradies never see other applicants, prices, or applicationCount.
  ↓
Client sees applicants at /jobs/posted/:postId:
  - applicationCount + each applicant's cover message, full quote (expandable
    line-item breakdown), rating, and a profile link that opens in a new tab.
  - "Accept quote" button on each pending application (legacy quote-less
    applications fall back to the old "Pick this tradesperson" path).
  ↓
acceptApplicationQuote (callable, transactional) — the bid-marketplace accept:
  - Merges acceptApplication + clientAcceptQuote in one atomic step. Re-checks
    post open + selectedApplicantId null + application pending + tradie still
    isVisible + application has a quote. Pre-allocates job + chat ids.
  - Creates jobs/{newJobId} already active: status="in_progress" (or
    "awaiting_upfront_payment" when the quote carried an upfront fee, with the
    UpfrontFeeState block) + sourcePostId + copied post fields, including the
    post's trade-specific intakeFormData (carried onto the job brief).
  - Materializes quotes/{newJobId} with status="accepted" and an assigned
    quoteNumber (from the tradie's nextQuoteNumber sequence).
  - Creates chats/{newChatId}; marks the chosen application "selected"; closes
    the post (convertedJobId, selectedApplicantId); post-commit rejects +
    notifies the other pending applicants and copies WebP photos to
    jobs/{jobId}/intake/.

acceptApplication (callable) — legacy path, retained for quote-less
applications: creates the job in status="accepted" (tradie then sends a formal
quote via submitQuote). Same atomic guards + photo copy.
  ↓
onJobPostClosed trigger fans out rejection notifications to all other
applicants (paged in batches of 400).
  ↓
The post's trade-specific questionnaire answers carry onto the job's
intakeFormData and show read-only on the brief tab — the detail captured at
post time follows the work through, so there's no separate "complete the brief"
step for marketplace jobs. (Direct /request/:uid jobs still gather the intake
at request time via the editable IntakeFormRenderer; legacy quote-less
acceptApplication jobs land in "requested" with whatever the post carried.)
  ↓
Escape hatch: while status is still "accepted", the client can "Return to
applicants" (returnToApplicants callable). This cancels the new job, flips
the post back to "open", and returns the chosen applicant to "pending".
Rejected applicants stay rejected — no re-spam.
  ↓
Posts auto-expire after 30 days via scheduledJobPostExpiry (daily); the
onJobPostClosed trigger handles applicant fanout the same way.
```

**Bid-blind contract**: `applicationCount` and `selectedApplicantId` live in `jobPosts/{postId}/private/meta` — rules allow only the post-owning client + admin to read that subdoc. The parent doc carries no signal of how many tradies have applied or who was picked. Applications themselves are readable only by the post owner, the application's own tradie, or admin (collectionGroup queries auto-filter via the same predicate).

**Address-privacy contract**: `addressPublic = { city, region, postalFsa, geohashPublic (length 6, ~1.2km cell) }` on the parent doc. `addressPrivate = { line1, fullPostal, geo, geohashExact (length 9) }` in `private/meta`. Tradies can browse by distance without learning the exact address; the exact address is copied into the converted job on acceptance, where the job's party-based rules govern access.

**Caps and limits (enforced in callables)**: 5 open posts per client; 10 applications per tradie per 24h (via rateLimits/{key} doc); post expiry 30d.

### 4.7 Rebates & Grants panel (added in Phase 5c)

A contextual, **informational** panel shown inside the post-a-job flow when the chosen trade matches a curated government/utility rebate or grant program. Energy-relevant work (heat pumps/HVAC, solar, insulation, windows, heat-pump water heaters) often has rebates a homeowner would otherwise miss — Blue Seal surfaces them at the moment the job is posted.

**Eligibility-safety contract (non-negotiable)**: the product **never asserts a client is eligible**. Programs are surfaced as *"you may qualify"*; each shows its own eligibility conditions, a *verified* date, and links to the **official source** to confirm and apply. We don't administer the programs or guarantee amounts. Closed/paused programs are retained (with `status`) but never surface in the client panel.

**Matching**: a program surfaces for a job when `status == "active"` AND its `trades` include the job's trade AND (`national` OR `provinces` includes the job's `region`). Province-specific programs only appear once the client's region is known, so we never imply availability before location is given. Panel caps at 4.

**Data**: admin-curated Firestore collection `rebatePrograms/{slug}` (see Data Model + Security Rules). World-readable reference data; admin-only writes (no callable — the admin form validates with Zod at the boundary). A code seed (`src/data/rebatePrograms.ts`, web-verified starter set) is the read fallback when the collection is empty, and the source for the admin "Import starter set" action. Admins keep the live copy current without code deploys; the post-a-job panel + the admin screen (`/admin/rebate-programs`) are the only surfaces — there is **no** standalone public rebates page.

---

## 5. Core Features

### 5.1 Discovery & Search
- Map view (Google Maps JS API) + list view
- Filters: trade, distance, min rating, available this week
- Marker clustering for dense areas
- Tradesperson cards: name, primary trade(s), rating + count, distance, verified badges, "Available [day]"

### 5.2 Tradesperson Profile (Public)
- Photo, bio, trades, service area circle on map, portfolio photos
- Rating breakdown (overall + per dimension)
- Recent reviews
- Pricing display (hourly rate, "Quote on request", or both)
- Read-only availability calendar
- Verified-trade badges (one per approved cert) + "ID Verified" badge
- **Google reviews (opt-in)**: a tradesperson can connect their Google Business Profile (OAuth) to show their Google rating + recent reviews in a separate, clearly-attributed section. Cached on `tradespeople/{uid}.googleReviews` (server-managed; refreshed daily + on-demand). Deliberately **never merged** into the native `ratingAvg`/`ratingCount` — different provenance, not mutual-blind, not tied to a verified Blue Seal job. Connect/disconnect from Account → Tradesperson → Google reviews. The encrypted OAuth refresh token lives in the server-only `tradespeople/{uid}/secure/google` doc (no client read/write). Useful for newer/just-claimed pros who already have a Google reputation. (Setup is human-gated — see HUMANTASKS.md → "Google Business reviews integration".)

### 5.3 Trade-Specific Intake Forms
- Each trade has a JSON schema (`intakeFormSchemas/{trade}` collection) defining its custom fields
- `IntakeFormRenderer.vue` reads schema and renders typed PrimeVue inputs, Zod-validated
- Photos required on every form (minimum 1, max 8)
- Schemas seeded via Firestore on first deploy; admin UI for editing comes later

### 5.4 Booking & Calendar
- Weekly recurring availability + one-off blocks
- Booking is request-driven: client submits → tradie accepts and proposes date
- Confirmed bookings sync to calendar; status flows through kanban
- ICS export for clients (email attachment)
- v1.1: two-way Google Calendar sync for tradies

### 5.5 Jobs (Project Tracking)
- Kanban dashboard for tradies (7 columns including "Accepted" for marketplace-originated jobs awaiting client brief)
- Simple status list for clients
- Per-job detail panel: chat + intake (editable for marketplace `accepted` status, read-only otherwise) + schedule + invoice + private notes. AI help is in the always-on assistant panel (§5.9), not a per-page widget.
- Status flow: `accepted → requested → quoted → scheduled → in_progress → awaiting_payment → complete → reviewed → cancelled`
- `accepted` is the entry status for marketplace-originated jobs (see §4.6); direct-request jobs skip it and start at `requested`.

### 5.6 Chat
- One thread per job (no general DMs — keeps everything tied to accountability)
- Text + photo (Storage path: `chats/{chatId}/`)
- Realtime via Firestore `onSnapshot`
- All messages immutable (legal accountability)
- The AI assistant reads the full chat transcript as context when scoped to a job (§5.9)

### 5.7 Reviews (Mutual)
- **Public** (client → tradie): 1–5 stars overall + per-dimension (quality, punctuality, communication, value) + text. Surfaces on tradie profile.
- **Private** (tradie → client): 1–5 stars + text + category scores. Visible only to users with `role: "tradesperson"`.
- One review per party per job, 14-day window
- Cloud Functions aggregate to denormalized `ratingAvg` / `clientRatingAvg`

### 5.8 Auto-Invoicing
- Draft invoice auto-created when job marked Complete
- Inline-editable line items (PrimeVue DataTable)
- PDF generated via `pdfkit` in Cloud Function, stored in Cloud Storage
- Emailed via Firebase "Trigger Email" extension (SendGrid or Mailgun backend)
- Statuses: `draft → sent → viewed → paid` (or `overdue`)
- Sequential numbering per tradie (`INV-2026-0001`), stored on tradie doc as `nextInvoiceNumber`
- **MVP:** manual mark-as-paid + payment instructions text on invoice (tradie sets in profile)
- **v1.1:** Stripe Connect Express for in-app payment via "Pay now" button — platform takes application fee (primary monetization)

### 5.9 AI Assistant (Paid — Tradesperson; Free — Admin)

A persistent in-app chatbot for tradespeople and admins, surfaced as a floating bubble bottom-right and a slide-in side panel. Powered by **Vertex AI Gemini 2.5 Flash** via the Cloud Function service account (no API keys; one-time `aiplatform.googleapis.com` enable on the GCP project).

**Conversation scoping** — one thread per `(userId, scope, jobId)` tuple:
- `scope: "job"` — auto-binds on `/jobs/:id`. The per-turn system prompt is grounded in the job's intake form data, intake photos, and the last 40 client↔tradesperson chat messages. Both tradies and admins get this when they open a specific job.
- `scope: "general"` — a rolling thread per tradie for advice not tied to a specific job ("how do I price this kind of work in BC?").
- `scope: "admin"` — a cross-page thread per admin. The current page route is injected into the per-turn prompt so the bot is aware of what the admin is viewing (vetting queue, user detail, etc.) without spawning a thread per page.

**Quick-prompts** — on a fresh job thread, three chips pre-fill the composer with templated prompts: Diagnose, Quote, Summary. These replace the standalone callables that used to live as buttons in the Job Detail panel; users can edit before sending and continue the conversation in the same thread.

**Subsumed:** the old `aiDiagnose` / `aiQuote` / `aiSummarize` callables and the `AiToolsPanel` UI component (decision 2026-05-22 — single AI surface beats three separate buttons; results are now part of a thread the tradie can follow up in rather than a one-shot modal). The callables remain deployed during the migration window but should be removed once the chatbot has been in production for a couple of weeks with no rollback signal.

**Gating:** the chatbot is open to all tradespeople (and admins). Originally planned as a paid-tier feature gated on `hasActiveSubscription`; that subscription model was scrapped in the 2026-05 monetization pivot in favour of a 12% Stripe Connect commission on each completed payment, and the gate (plus the field) was removed. Role check (`tradesperson` or `admin`) still applies.

**Data:** conversations live at `assistantConversations/{id}` with a `messages/` subcollection; both turns are persisted server-side by the `aiChat` callable in a single batch so partial conversations never land. `aiUsage` entries are written per turn with `tool: "chat"`.

### 5.10 Admin Console
- Pending vetting queue (cert + ID review combined)
- User search + detail view (any role)
- Job / chat lookup for support
- Flagged content queue (user reports)
- Subscription overview
- Audit log (every admin action)
- Platform metrics (DAU, signups by role, GMV proxy, AI usage, vetting backlog depth)

---

## 6. Data Model (Firestore)

> Define these as TypeScript interfaces in `src/firebase/interfaces.ts` per the architecture in `TECH_STACK_SETUP.md`. Use Zod schemas in `src/validation/` for runtime validation of inputs.

```
users/{uid}
  role: "client" | "tradesperson" | "admin"
  displayName, email, photoURL, phone
  createdAt, lastActiveAt
  emailVerified: bool
  // clients only:
  clientRatingAvg: number        // visible to tradies
  clientRatingCount: number

tradespeople/{uid}                // doc id = uid
  bio
  trades: string[]                // canonical trade keys, primary at [0]
  yearsExperience: { [trade]: number }
  pricingModel: "hourly" | "quote" | "both"
  hourlyRate: number              // cents, null when quote-only
  providesFreeQuotes: bool
  location: GeoPoint
  geohash: string                 // length 9
  serviceRadiusKm: number
  primaryAddressText: string
  portfolioPhotos: string[]       // Storage paths
  ratingAvg, ratingCount          // denormalized
  ratingDimensions: { quality, punctuality, communication, value }
                                  // each {avg, count}
  verifiedTrades: string[]        // set by onCertApproved
  idVerified: bool                // set by onIdApproved
  vettingStatus: "draft" | "pending" | "info_requested" | "approved" | "rejected"
  vettingNotes: string            // admin's notes if info_requested or rejected
  isVisible: bool                 // true only when vettingStatus == "approved" AND idVerified
  weeklyAvailability: { mon: [{start, end}], ... }
  nextInvoiceNumber: number
  paymentInstructions: string     // copied onto invoices when sent

certifications/{certId}
  tradespersonId, trade, issuingBody, certNumber, expiresAt
  fileUrl                         // Storage path
  status: "pending" | "approved" | "rejected"
  reviewedBy, reviewedAt, rejectionReason
  submittedAt

idVerifications/{tradespersonId}  // doc id = uid, one per tradie
  fileUrl                         // Storage path; admin-only read
  documentType: "drivers_license" | "passport" | "provincial_id"
  status: "pending" | "approved" | "rejected"
  submittedAt, reviewedBy, reviewedAt, rejectionReason

intakeFormSchemas/{trade}         // doc id = trade key (e.g. "plumber")
  trade: string
  version: number
  fields: [{ key, label, type, options?, required?, helpText? }]
  updatedAt

jobs/{jobId}
  clientId, tradespersonId
  status: "accepted" | "requested" | "quoted" | "scheduled" | "in_progress"
        | "awaiting_payment" | "complete" | "reviewed" | "cancelled"
  trade: string                   // primary trade for this job
  title, description
  intakeFormData: object          // client's submitted form data; {} on marketplace jobs until the client completes the brief
  intakePhotos: string[]          // Storage paths, required >= 1 (copied from job post on acceptance)
  address: { line1, city, region, postalCode, geo: GeoPoint }
  preferredDateWindow: { start, end }
  urgency: "flexible" | "this_week" | "urgent"
  scheduledStart, scheduledEnd
  createdAt, completedAt, cancelledAt, cancelledReason
  chatId
  privateNotes: string            // tradie-only
  sourcePostId: string | null     // set when this job came from the job-board marketplace (§4.6)

jobPosts/{postId}                 // job-board marketplace (§4.6)
  clientId
  status: "open" | "closed" | "cancelled" | "expired"
  trade: string
  title, description
  photos: string[]                // 1-8 WebP paths under jobPosts/{postId}/photos/
  addressPublic: { city, region, postalFsa, geohashPublic }   // length-6 geohash, ~1.2km cell
  budget: { min, max, currency: "CAD" }                       // cents
  urgency, preferredDateWindow
  convertedJobId: string | null
  createdAt, expiresAt, closedAt, acceptedAt, editedAt

jobPosts/{postId}/private/meta    // client + admin read only
  addressPrivate: { line1, fullPostal, geo: GeoPoint, geohashExact }   // length 9
  applicationCount: number
  selectedApplicantId: string | null

jobPosts/{postId}/applications/{tradieId}    // doc id = tradie uid (one app per tradie)
  tradespersonId, postId, clientId
  status: "pending" | "selected" | "rejected" | "withdrawn"
  message: string                 // 20-2000 chars
  proposedPrice: { type: "fixed" | "hourly", amount, notes? }   // cents
  proposedStartDate
  createdAt, updatedAt

chats/{chatId}
  jobId, clientId, tradespersonId
  lastMessageAt, lastMessagePreview
  unreadCounts: { [uid]: number }

chats/{chatId}/messages/{messageId}    // subcollection
  senderId, text, photoUrl, createdAt
  type: "text" | "photo" | "system"

reviews/{reviewId}                // PUBLIC: client → tradie
  jobId, clientId, tradespersonId
  rating: 1-5
  dimensions: { quality, punctuality, communication, value }   // each 1-5
  text, createdAt
  status: "active" | "flagged" | "hidden"

clientReviews/{reviewId}          // PRIVATE: tradie → client
  jobId, clientId, tradespersonId
  rating: 1-5, text
  categoryScores: { punctuality, communication, clarity, payment }
  createdAt
  // Readable only by users with role: "tradesperson"

bookings/{bookingId}              // one-off blocks / holds
  tradespersonId, start, end
  type: "blocked" | "booked"
  jobId: string | null

invoices/{invoiceId}
  tradespersonId, clientId, jobId
  invoiceNumber: "INV-2026-0001"
  status: "draft" | "sent" | "viewed" | "paid" | "overdue" | "void"
  lineItems: [{ description, quantity, unitPrice, taxRate }]
  subtotal, taxTotal, total, currency
  issuedAt, dueAt, sentAt, viewedAt, paidAt
  pdfUrl                          // Storage path
  paymentInstructions: string     // copied from tradie profile at send time
  paymentMethod: "manual" | "stripe"
  recurring: { enabled, frequency, nextRunAt } | null

aiUsage/{usageId}                 // analytics + abuse prevention
  userId, jobId (nullable for chat), tool ("diagnose"|"quote"|"summary"|"chat"), tokensIn, tokensOut, createdAt

assistantConversations/{conversationId}    // see §5.9
  userId, scope ("job"|"general"|"admin"), jobId (nullable),
  title, lastMessageAt, lastMessagePreview, messageCount, createdAt

assistantConversations/{conversationId}/messages/{messageId}  // subcollection
  role ("user"|"assistant"), content, createdAt,
  tokensIn, tokensOut, contextSnapshot (pageRoute, jobId, chatMessagesIncluded)

auditLog/{entryId}                // admin actions, immutable
  actorUid, action, targetType, targetId, reason, metadata, createdAt

rebatePrograms/{slug}             // curated rebate/grant reference data (§4.7)
  slug, name, provider
  level: "federal" | "provincial" | "municipal" | "utility"
  national: bool                  // true = Canada-wide (provinces ignored)
  provinces: string[]             // CA province codes when not national
  trades: string[]                // trade keys it applies to (matching)
  summary, amountNote             // qualitative, as the official source states
  eligibilityNote                 // conditions shown to client — never a promise
  officialUrl                     // required https source / application link
  status: "active" | "closed" | "paused"   // only active surfaces to clients
  lastVerifiedAt, createdAt, updatedAt, updatedBy
  // World-readable; admin-only writes (no callable). Code seed in
  // src/data/rebatePrograms.ts is the fallback when the collection is empty.
```

### Denormalization rules

These fields are denormalized for read performance and **must** be updated by Cloud Functions, never by the client:

| Field | Updated by |
|---|---|
| `tradespeople.ratingAvg`, `ratingCount`, `ratingDimensions` | `onReviewCreated` |
| `tradespeople.verifiedTrades` | `onCertApproved` |
| `tradespeople.idVerified`, `isVisible` | `onIdApproved` (and `onCertApproved` if all certs done) |
| `tradespeople.payouts.*` | `stripeWebhook` (`account.updated` for onboarding state; subsequent `payout.*` events write `/payouts/{po_…}` rather than the tradesperson doc) |
| `invoices.payment.*`, `invoices.status` | `stripeWebhook` (`payment_intent.*`, `charge.refunded`, `charge.dispute.*`) |
| `users.clientRatingAvg`, `clientRatingCount` | `onClientReviewCreated` |
| `chats.lastMessageAt`, `lastMessagePreview` | `onMessageCreated` |

### Storage paths

```
users/{uid}/profile/             — avatar
tradespeople/{uid}/portfolio/    — portfolio photos
tradespeople/{uid}/certs/        — cert uploads
tradespeople/{uid}/id/           — ID upload (ADMIN-ONLY READ)
jobs/{jobId}/intake/             — client's intake form photos
chats/{chatId}/                  — chat photo attachments
invoices/{invoiceId}.pdf         — generated invoice PDFs
```

---

## 7. Security Rules — Key Principles

- **Default deny everything.** Never leave a collection without an explicit rule.
- A user can only read/write their own user doc; aggregate rating fields are set only by Cloud Functions.
- Tradesperson profiles are world-readable when `isVisible: true`.
- Certifications: only owner can create, only admin can read or update `status`.
- **ID verifications: only owner can create, only admin can read or update.** Never world-readable, never client-readable.
- Jobs/chats: read/write only by `clientId` or `tradespersonId` involved, plus admin.
- Public reviews: client can create one per `complete` job they own; world-readable.
- Private client reviews: tradie can create one per job they completed; readable only by users with `role: "tradesperson"` and admin.
- AI assistant (`aiChat`): callable open to tradespeople and admins; role check is enforced server-side. The original paid-tier gate (`hasActiveSubscription`) was removed with the 2026-05 monetization pivot — revenue comes from the per-payment Connect commission, not an AI subscription.
- `assistantConversations/{id}` + `/messages/`: owner-only read; all writes go through the `aiChat` callable (admin SDK bypasses rules) so partial conversations never persist.
- Audit log: write-only via Cloud Function, read by admins only.
- Intake form schemas: world-readable, admin write only.

Use custom claims (`request.auth.token.role`) for role checks, not doc lookups (cheaper + faster). Every rule needs both an allow and a deny test in `tests/rules/`.

---

## 8. Cloud Functions

Live in `functions/src/`, organized by domain (`auth/`, `vetting/`, `reviews/`, `payments/`, `ai/`, `invoicing/`, `audit/`).

**Auth & roles**
- `setRoleOnSignup` — sets `client` or `tradesperson` claim based on signup path
- `setAdminRole` — admin-only callable, promotes a user

**Vetting**
- `submitForVetting` — callable; validates required uploads present, flips `vettingStatus → "pending"`, notifies admin
- `onCertApproved` — trigger; updates `verifiedTrades`; flips `isVisible` if all certs + ID done
- `onIdApproved` — trigger; sets `idVerified: true`; same downstream check
- `requestInfo` — admin callable; sets `vettingStatus → "info_requested"` + notes, logs audit
- `rejectApplication` — admin callable; sets `vettingStatus → "rejected"` + reason, logs audit
- `scheduledIdRetention` — scheduled daily; deletes ID files 90 days post-approval

**Reviews & ratings**
- `onReviewCreated` — recomputes `ratingAvg`/`ratingCount`/`ratingDimensions`
- `onClientReviewCreated` — recomputes `clientRatingAvg`/`clientRatingCount`

**Payments (Stripe Connect, 12% commission per payment)**
- `stripeWebhook` — handles Connect (`account.updated`, `payout.*`) and platform events (`payment_intent.*`, `charge.refunded`, `charge.dispute.*`); mirrors state onto `tradespeople.payouts`, `invoices.payment`, `/payouts/{po_…}`, `/disputes/{dp_…}`
- `createConnectAccount` / `createConnectOnboardingLink` / `createConnectLoginLink` — tradesperson Connect Express onboarding + dashboard access
- `sendInvoice` — creates the Stripe PaymentIntent (with `application_fee_amount` + `transfer_data.destination = acct_…`) so the commission split happens at capture time
- `backfillPayoutsField` — one-shot admin callable that seeds `payouts: not_started` on existing approved tradespeople; precondition for the deferred `maybeMarkVisible` tightening

**AI**
- `aiChat` — primary callable for the persistent assistant (§5.9). Auto-resolves or creates the conversation per `(userId, scope, jobId)`, loads job context when scope is `job`, replays the prior turns, persists user + assistant turns atomically, logs to `aiUsage` with `tool: "chat"`.
- `aiDiagnose`, `aiQuote`, `aiSummarize` — legacy one-shot callables, subsumed by `aiChat`'s quick-prompts. Still deployed during the migration window but slated for removal once the chatbot has bedded in.

**Invoicing**
- `onJobCompleted` — auto-creates draft invoice
- `sendInvoice` — callable; renders PDF via `pdfkit`, triggers email via Trigger Email extension, marks sent
- `processRecurringInvoices` — scheduled daily
- `markInvoiceOverdue` — scheduled daily

**Audit**
- `logAdminAction` — internal helper; called from every admin callable to write to `auditLog`

**Job-board marketplace (§4.6)**
- `createJobPost` — client callable; 5-open-posts cap, derives geohashes server-side, writes parent + private/meta
- `submitApplication` — vetted-tradie callable; bid-blind contract enforced; 10-apps-per-day rate limit; carries a full itemized quote (server-recomputed totals via lib/quoteTotals.ts, stored as ApplicationQuote)
- `withdrawApplication` — pending-only tradie callable
- `acceptApplicationQuote` — client (post owner) callable; transactional; accepts an applicant's quote → job (in_progress / awaiting_upfront_payment) + quotes/{jobId} (accepted) + chat, rejects + notifies the other applicants, post-commit photo copy
- `acceptApplication` — client (post owner) callable; legacy quote-less path; transactional job + chat creation; post-commit photo copy
- `returnToApplicants` — client callable; escape hatch while job is still in `accepted` status
- `cancelJobPost` — client callable
- `onJobPostClosed` — trigger; pages applications and fans rejection notifications
- `onApplicationCreated` — trigger; belt-and-suspenders client notification
- `scheduledJobPostExpiry` — daily 03:00 America/Vancouver; flips open posts past `expiresAt` to `expired`

All callable functions must:
- Enforce App Check (`enforceAppCheck: true`)
- Validate input with Zod
- Convert errors to `HttpsError` with safe messages
- Use structured logging (no `console.log`)

---

## 9. PWA Requirements

- Vite PWA plugin (Workbox)
- Manifest with name "Blue Seal", short_name, icons, theme_color, `display: standalone`
- Service worker: shell cache + recent profile views, offline fallback page
- Install prompt UI on 2nd session
- **v1.1:** FCM push notifications (new message, request received, booking confirmed, invoice sent/paid)

---

## 10. Build Phases

**Read in order. Each phase depends on the previous.**

Setup is fully covered in `TECH_STACK_SETUP.md`. Below is the product build sequence — start it after the setup doc is complete.

**Phase 1 — Foundation (1–2 days)**
- 3-role auth (`client`, `tradesperson`, admin promoted via CLI)
- Role-based router guards
- Empty dashboards per role
- Firestore + Storage security rules baseline (default-deny + explicit allows per collection)
- Design tokens, base theme, mobile-first layout shell

**Phase 2 — Tradesperson Onboarding (2–3 days)**
- Multi-step signup wizard (PrimeVue Stepper)
- Profile → trades → pricing → service area → availability → certs → ID → submit
- Cert + ID upload to Storage with restricted rules
- `submitForVetting` callable
- "Under review" holding state on tradie dashboard

**Phase 3 — Admin Vetting Console (1–2 days)**
- Vetting queue (sorted by `submittedAt`)
- Application detail: side-by-side cert + ID review, watermarked ID display
- Approve / Request Info / Reject actions
- `onCertApproved` + `onIdApproved` triggers
- `auditLog` writes on every action

**Phase 4 — Discovery (1–2 days)**
- Google Maps integration with marker clustering
- Search + filter UI, geohash distance queries
- Public tradesperson profile page (with read-only availability calendar)

**Phase 5 — Intake Forms & Request Flow (1–2 days)**
- Seed `intakeFormSchemas` for top 5 trades
- `IntakeFormRenderer.vue` — dynamic form from schema
- Client request submission with required photo upload
- Job + Chat creation
- Client dashboard (simple job list)

**Phase 6 — Tradesperson Workflow: Kanban + Calendar + Chat (3–4 days)**
- Kanban dashboard with drag-to-update
- Calendar view (same data, different render)
- Job Detail panel (chat + intake view + schedule picker + private notes)
- Realtime chat with photo upload
- Status transitions + client notifications

**Phase 7 — Mutual Reviews (1 day)**
- Public review (client → tradie) with dimension breakdown
- Private review (tradie → client)
- Aggregation Cloud Functions
- Review display on profile + private surfacing on incoming requests

**Phase 8 — Stripe Subscription + AI Assistant (2 days)**
- Stripe Checkout + webhook for tradesperson AI subscription
- `aiChat` callable + persistent assistant panel (§5.9), grounded in per-job chat + intake when scoped to a job
- Floating bubble + side panel mounted in `App.vue`, tradesperson + admin only

**Phase 9 — Invoicing (1–2 days)**
- Install Firebase "Trigger Email" extension
- Auto-draft on job complete, invoice editor, PDF gen, send flow
- Client invoice view + mark-paid flow
- Scheduled function for overdue flagging

**Phase 10 — PWA Polish + Launch Readiness (1 day)**
- Manifest, service worker, install prompt, offline page
- Sentry error tracking
- Analytics
- End-to-end smoke test of all flows

**Total target: ~3 weeks** of focused build with Claude Code carrying implementation.

---

## 11. Working Agreements (for Claude Code)

**Before writing any code:**
1. Confirm `TECH_STACK_SETUP.md` setup is complete.
2. Read this document end-to-end. Skim it again at the start of every new session.
3. Identify which build phase (above) you're working in.

**Architecture (recap from `TECH_STACK_SETUP.md`):**
- Firebase services as pure async functions in `src/firebase/services/`. No classes. Functions return typed data (`WithId<T>[]`).
- All Firestore document interfaces in `src/firebase/interfaces.ts`.
- Zod schemas in `src/validation/` for runtime validation of inputs (both client form submits and Cloud Function inputs).
- Admin views are self-contained (local state, no Pinia stores).
- PrimeVue imported per-component, not globally.
- Composables in `src/composables/` (barrel-exported via `index.ts`) for shared UI logic.
- TypeScript strict. No `any` — use `unknown` and narrow.

**Conventions:**
- `<script setup lang="ts">` only. No Options API.
- Type props and emits with TS generics, not runtime declarations.
- Never call Firestore directly from a component — go through a `services/` function (or composable that wraps one).
- Use `serverTimestamp()` for time fields. Never trust client timestamps.
- Cloud Function callables: enforce App Check, validate input with Zod, log structured, convert errors to `HttpsError`.
- Security rules: default-deny; custom claims for role checks (no doc lookups); allow + deny tests for every rule.
- Mobile-first. Everything must work at 375px width.

**After every feature:**
- All tests pass (`npm run test:run`)
- Build succeeds (`npm run build` — type-check included)
- Security rules tested (allow + deny cases)
- Commit message names the phase and feature (e.g. `Phase 5: intake form renderer`)

**When a pattern repeats 3+ times,** stop and extract it (helper, composable, base component). Don't let convention drift.

**When making a non-obvious architectural choice,** add a one-paragraph note as a code comment AND mention it in the commit body.

---

## 12. Feature Backlog

✅ **MVP** = ship now. 🟡 **v1.1** = next milestone. 🔵 **Backlog** = validated ideas, prioritize from usage data.

### Trust & Verification
- ✅ MVP — Cert upload + admin approval
- ✅ MVP — Government ID upload + admin approval
- ✅ MVP — Verified-trade badges + ID Verified badge
- 🟡 v1.1 — Stripe Identity for automated ID verification
- 🟡 v1.1 — Insurance certificate upload + expiry reminders
- 🔵 Backlog — Background checks, tiered trust levels, public trust URL

### Discovery & Matching
- ✅ MVP — Map + list search with filters
- 🟡 v1.1 — Saved searches with alerts, client favorites
- 🟡 v1.1 — AI-powered matching ("describe your problem")
- 🔵 Backlog — "Available now" mode, featured listings, service-area heatmaps
- ✅ MVP — **Job board / bid marketplace** (§4.6) — clients post open jobs, vetted tradies apply with a cover message + full itemized quote, client compares quotes and accepts one (`acceptApplicationQuote`). Bid-blind. Address-private until acceptance. Coexists with direct-request flow.

### Communication
- ✅ MVP — Per-job chat with text + photo
- 🟡 v1.1 — Voice notes, read receipts, FCM push notifications
- 🟡 v1.1 — Email digests
- 🔵 Backlog — AI translation, suggested replies, video call

### Booking & Scheduling
- ✅ MVP — Weekly availability + request → quote → schedule
- ✅ MVP — ICS export to client calendars
- 🟡 v1.1 — Google Calendar two-way sync, buffer times, recurring bookings
- 🔵 Backlog — Smart route scheduling, multi-tradie bookings

### Jobs & Project Tracking
- ✅ MVP — Kanban (6 columns) + Job Detail panel
- 🟡 v1.1 — Photo gallery (before/during/after), materials checklist, time tracking, job templates
- 🔵 Backlog — Crew assignments, sub-tasks

### Payments & Invoicing
- ✅ MVP — Auto-draft invoice, PDF gen, email, manual mark-as-paid
- 🟡 v1.1 — Stripe Connect Express + in-app pay button (platform fee)
- 🟡 v1.1 — Tax handling (GST/PST/HST), recurring invoices, deposits
- ✅ MVP — Per-job time tracking (clock in/out) + receipt-OCR expenses with markup, pulled into invoice via "Pull from job" button
- 🔵 Backlog — Quote → invoice conversion, tax export

### Reviews & Reputation
- ✅ MVP — Mutual reviews (public client→tradie, private tradie→client)
- 🟡 v1.1 — Tradie response to public reviews, photo reviews
- 🔵 Backlog — Public client reputation, Q&A on profile

### AI Tools (Tradesperson, paid)
- ✅ MVP — Diagnose, Quote Helper, Job Summary (all chat-aware)
- 🟡 v1.1 — Estimate generator, code reference lookup, voice-to-notes
- 🔵 Backlog — Client-facing AI triage, materials price lookup, photo measurement

### Business Tools (Tradie)
- ✅ MVP — Profile editor, calendar, kanban, invoices
- 🟡 v1.1 — Business analytics, client CRM lite, onboarding checklist
- 🔵 Backlog — Team accounts, white-label public booking page

### Client Tools
- ✅ MVP — Search + request + chat + review
- 🟡 v1.1 — Property profile (home details for context), re-book in one tap
- 🔵 Backlog — Multi-property, maintenance reminders

### Admin & Operations
- ✅ MVP — Vetting queue (cert + ID), user search, audit log
- 🟡 v1.1 — User suspension, flagged content queue, refunds, metrics dashboard
- 🔵 Backlog — Bulk operations, feature flags

### Growth & Engagement
- 🟡 v1.1 — Referral program, promo codes, SEO public pages
- 🔵 Backlog — Blog/CMS, email automation, social proof widgets

### Platform / Infra
- ✅ MVP — PWA install
- 🟡 v1.1 — FCM push, multi-region (BC → Alberta → national), Sentry, analytics
- 🔵 Backlog — Native iOS/Android shells (Capacitor), i18n (French for Quebec)

---

## 13. Out of Scope for MVP

- In-app client→tradie payments (offline via invoice instructions until v1.1 brings Stripe Connect)
- Escrow / dispute resolution beyond admin manual handling
- Push notifications (email + in-app realtime via Firestore listeners at launch; FCM in v1.1)
- Pre-acceptance 1:1 chat between client and individual applicants (deferred to v1.1; mitigated at MVP by the "Return to applicants" escape hatch — see §4.6)
- Editing a posted job after applications exist (v1.1)
- Re-opening a closed/expired post (v1.1; for now the client reposts)
- Multi-language
- Native iOS/Android shells (PWA only)
- Background checks beyond cert + ID
- Multi-currency

---

## 14. Open Questions

1. **Launch region?** — affects which trades licensing bodies to reference, default currency, tax setup, geohash precision tuning. Working assumption: BC (Okanagan / Vancouver Island) first.
2. **AI subscription price?** — affects monetization model and how aggressively to push AI in onboarding. Suggest $39 CAD/mo to start.
3. **Phone verification at signup?** — adds friction but reduces spam. MVP suggestion: optional for clients, required for tradies.
4. ~~**One account or separate for dual-role users?** — tradies are often also homeowners. Working assumption: one Firebase Auth user can have either `client` or `tradesperson` role, not both. Dual-role users create a second account.~~ **Resolved (2026-05-21):** one account holds both roles (Airbnb-style). `UserDoc.roles: Role[]` + `activeRole`; custom claim becomes `roles: string[]`. Adding `tradesperson` to an existing client still goes through cert + ID vetting (same gate as fresh tradie signup). Role switcher lives in the header menu; "Become a tradesperson" / "Add client view" CTAs live on `/account`. Implemented via `addRoleToSelf` callable + `setActiveRole` direct doc write.
5. **Trade-licensing source of truth?** — issuing bodies vary by province. MVP: free-text issuing body + admin verifies against the cert image. Future: structured list per region.

These should be answered before phase 2 to avoid rework.
