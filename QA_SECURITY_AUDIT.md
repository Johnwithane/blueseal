# Blue Seal — QA & Security Audit

**Date:** 2026-05-21
**Branch:** main
**Scope:** Full repo — rules, Cloud Functions, services, validation, Vue views/components, auth, hosting headers, design coverage.
**Methodology:** Four parallel deep-dive audits (rules + storage + CSP, Cloud Functions, services + validation + auth, Vue layer) plus first-pass reads on the highest-value files.

The first half of this document is what **changed in this audit pass** — bugs fixed and where they were. The second half is the full inventory of findings (fixed and deferred), user stories from all sides, and the design gaps that came up. Items in the inventory that aren't checked were either fixed in this pass or are documented as a follow-up.

---

## 1. What got fixed this pass

### 1.1 Firestore rules — [firestore.rules](firestore.rules)
- **Privacy regression closed:** `users/{uid}` no longer leaks to anyone signed-in via the `resource.data.role == 'tradesperson'` clause. Public tradesperson data should be read from `tradespeople/{uid}`; private fields (email, phone, Stripe ID, subscription) are owner + admin only.
- **Field allowlist on `users` create:** `keys().hasOnly([...])` blocks attacker-planted keys; `termsAcceptedVersion` required.
- **Positive-equality field guards on update:** replaced the deletion-bypassable `noServerFieldsTouched(...)` pattern with explicit `request.resource.data.X == resource.data.X` checks on `users`, `tradespeople`, `jobs`, `chats`, `invoices`, `certifications`, `idVerifications`.
- **Tradesperson lockdown:** approved tradies can no longer self-yank to `pending`; `nextInvoiceNumber` / `approvedAt` / `verifiedTrades` / `idVerified` / `isVisible` / `ratingAvg/Count/Dimensions` are server-managed.
- **Job identity fields immutable:** `clientId` / `tradespersonId` / `chatId` / `createdAt` / `trade` cannot be rewritten by a party. Client cannot rewrite tradie-only `privateNotes`.
- **Chat identity fields immutable** (M12).
- **Messages create hardened (H10):** `type` restricted to `text`/`photo`; `text.size() <= 5000`; system messages can't be forged.
- **Reviews create hardened (H4):** must reference an existing job, caller must be the party on the job, job status must be `complete` or `reviewed`, rating must be 1–5 integer. Hidden / flagged reviews not visible to the public (C2).
- **Client reviews create hardened (H5):** same — tradie can't defame a client they never worked with.
- **Invoices lockdown (H1):** create allowed only by tradies for jobs they're assigned to, status forced to `draft`. Update: identity + invoice number immutable; can't edit a paid invoice.
- **Certifications + ID verifications:** create requires server-set audit fields (`reviewedBy`/`reviewedAt`) to be null, update preserves them. ID create also requires `isTradie()` role claim.
- **Catalog / intakeFormSchemas / aiUsage / auditLog:** collapsed `allow write` expanded to explicit create/update/delete each.

### 1.2 Storage rules — [storage.rules](storage.rules)
- **Party-gated writes (C9):** `jobs/{jobId}/intake/*` and `chats/{chatId}/*` writes now consult Firestore (`firestore.get(...)`) to verify the caller is a party.
- **Party-gated reads (C10):** invoices read restricted to invoice party + admin (was world-readable to any signed-in user).
- **WebP/PDF extension requirement (H8):** content-type check now paired with filename extension regex so a `.html` lying about its MIME doesn't slip through.
- **Tighter size caps (H9):** chat + intake photos capped at 4 MB; certs/ID remain 10 MB for PDFs.

### 1.3 Hosting headers / CSP — [firebase.json](firebase.json)
- **Added missing CSP directives:** `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self' https://accounts.google.com`, `object-src 'none'`.
- **Added headers:** `Cross-Origin-Resource-Policy: same-site`, `X-Permitted-Cross-Domain-Policies: none`.
- **Narrowed `connect-src`:** removed wildcard `*.googleapis.com` / `*.firebaseio.com`, enumerated exact hosts (firestore, identitytoolkit, securetoken, maps, places, etc.).
- **Narrowed `img-src`:** removed wildcard `https:` (HTTPS-exfil channel), enumerated Storage + Google hosts.
- **Narrowed `script-src`:** dropped `*.cloudfunctions.net` and `*.run.app` (Cloud Functions don't ship JS to the browser).
- **Expanded `Permissions-Policy`:** disabled USB/Bluetooth/MIDI/serial/HID/idle-detection/accelerometer/gyroscope/magnetometer/interest-cohort, scoped fullscreen/payment/publickey-credentials-get to self.
- **Known limit:** `'unsafe-inline'` remains in `script-src` because Vite emits inline bootstrap scripts. See § 3.1 for the upgrade path.

### 1.4 Cloud Functions
- **`setAdminRole` ([functions/src/auth/setAdminRole.ts](functions/src/auth/setAdminRole.ts)):** verifies the target Auth user exists; merges with existing custom claims instead of overwriting; rolls back the Firestore write if the claim write fails; logs to audit.
- **`submitForVetting` ([functions/src/vetting/submitForVetting.ts](functions/src/vetting/submitForVetting.ts)):** now requires the `tradesperson` role claim; refuses re-submit when current status isn't `draft`/`info_requested`; ignores `rejected` certs when checking trade coverage.
- **`onReviewCreated` + `onClientReviewCreated`:** rating is range-checked (1–5, finite) before being applied; dimension keys locked to the documented four to block `__proto__` / arbitrary-key inflation; missing references logged for ops visibility.
- **`sendInvoice`:** status transition guard (only `draft`/`overdue` can be sent); refuses empty-total invoices; protects against the "re-send a paid invoice" loop.
- **`onJobCompleted`:** deterministic invoice document ID (`invoices/{jobId}`) — duplicate event delivery is naturally idempotent; year stamped using Toronto local time instead of `us-central1` server time.
- **`scheduledIdRetention`:** parsed Storage path must start with `tradespeople/{uid}/id/`; refuses to delete anything else (closes the "attacker-controlled `fileUrl` → privileged delete on arbitrary object" path). Scheduled in `America/Toronto` timezone; paginated. Doesn't overwrite `documentType` on cleanup.
- **`decisions.ts`:** notes/reason length-capped (`.max(2000)`); refuses if target tradesperson doc doesn't exist (instead of a generic INTERNAL).
- **`adminToggleSubscription`:** standardized to the canonical callable pattern (Zod, `requireAdmin`, target-exists + role check, audit-log entry). Webhook stub returns 503 (not 200) when secret is unconfigured so Stripe doesn't silently consume real events later.
- **`ai/tools.ts`:** mime type derived from the file extension instead of hard-coded `image/jpeg` (chat + intake photos are WebP per the recent WebP-only commit); raw Vertex error text no longer leaks to the client — generic `HttpsError('internal', …)` thrown instead.
- **`lib/mail.ts`:** validates `to` against a real email regex; length-caps subject/text/html; drops the dangerous `attachments[].path` (local-file-read coercion vector) in favor of inline `content` only.

### 1.5 Validation — [src/validation/schemas.ts](src/validation/schemas.ts)
- All string fields trimmed; explicit `.max()` caps everywhere (no more megabyte payloads through `min(2)`).
- `displayName` regex restricts to letters/numbers/spaces/`.'-`.
- Email schemas lower-cased and `.max(200)`.
- Phone regex (`/^\+?[\d\s\-()]{10,20}$/`).
- Canadian postal code regex (`A1A 1A1`) — matches the project's CA target market.
- Trade fields constrained to a `z.enum(TRADES.map(t => t.key))` — no more arbitrary trade strings entering the system.
- `yearsExperience` keys cross-checked against selected trades.
- `serviceRadiusKm` capped at 200 (was 500 / continent-scale).
- `lineItemSchema.unitPrice` capped at $100k cents; `taxRate` capped at 0.5.

### 1.6 Frontend bugs fixed
- **InvoiceEditor cents/dollars unit bug ([src/components/InvoiceEditor.vue](src/components/InvoiceEditor.vue)):** `unitPrice` is stored in cents but bound to PrimeVue's currency-mode `InputNumber` which treats the value as the visible currency unit. Typing "100" stored 100¢ = $1; the line total then showed $0.01. Now binds a separate `unitPriceDollars` UI value per row and converts to cents on save. Also: Zod-validates with `lineItemSchema` before save/send; double-submit guarded; `humanizeError()` on every failure path; "Save" persists before "Send".
- **`prompt()` rejection flows removed ([src/views/admin/ApplicationReviewView.vue](src/views/admin/ApplicationReviewView.vue)):** per-cert and per-ID rejection both go through PrimeVue dialogs with 2000-char-bounded textareas, matching the existing "Reject application" / "Request info" UX.
- **RequestQuoteView blob-URL memory leak ([src/views/RequestQuoteView.vue](src/views/RequestQuoteView.vue)):** previews are now pre-computed `URL.createObjectURL()` results stored alongside the file, and revoked on remove + on unmount. Photos upload in parallel after the job is created (so the storage path is the real `jobs/{jobId}/intake/`, not the orphan `${uid}-pending`). Form validated with `jobRequestSchema` (which already exists). Postal code normalized to uppercase before write. Double-submit guarded.
- **`updateJobIntakePhotos` service added ([src/firebase/services/jobs.ts](src/firebase/services/jobs.ts))** so the photos-upload-then-patch flow exists in the service layer per CLAUDE.md ("components never call Firestore directly").
- **`getInvoiceByJobId` service added ([src/firebase/services/invoices.ts](src/firebase/services/invoices.ts))**, replacing the inline `getDocs(query(collection(db, …)))` in `JobDetailView`. Tries the deterministic `invoices/{jobId}` doc first, falls back to a where-query for legacy invoices. `listClientInvoices` now has a `limit(100)`.
- **JobDetailView ([src/views/JobDetailView.vue](src/views/JobDetailView.vue)):** intake schema + invoice fetch now parallel; subscription state no longer pulled from the tradie's `users` doc by the client (closes a small PII surface); status-change confirms on `complete` / `cancelled` to match Kanban; toast + humanized errors on every action; `ChatThread` no longer receives `recipient-id` (the trigger derives it).
- **ChatThread ([src/components/ChatThread.vue](src/components/ChatThread.vue)):** photo URL origin validated against an allowlist of Firebase Storage hosts before rendering (`<img>` + `<a>`) — blocks any future drift that lets a `javascript:` or off-host URL into a message. `markRead` no longer takes a `userId` parameter (always uses the current auth user). `alert()` errors replaced with toast + humanized error. Subscription path also runs `markRead` correctly when changing chat without unmount.
- **`subscribeMessages`** defaults to `limitToLast(200)` so long-running chats don't load every message on subscribe.
- **Friendly errors helper ([src/utils/errors.ts](src/utils/errors.ts)):** maps Firebase Auth + Functions error codes to human copy. `auth/user-not-found` and `auth/wrong-password` collapse to the same message to prevent account-existence enumeration. Wired into SignInView, SignUpView, TradieSignUpView, ChatThread, AiToolsPanel, ReviewPrompt, InvoiceEditor, JobDetailView, RequestQuoteView, CertUploadCard, IdUploadCard.
- **ReviewPrompt ([src/components/ReviewPrompt.vue](src/components/ReviewPrompt.vue)):** `useToast()` hoisted to setup top-level; Zod-validates with `reviewSchema` / `clientReviewSchema` (which already existed but were unused); submit button disabled while pending.
- **AI tools ([src/components/AiToolsPanel.vue](src/components/AiToolsPanel.vue)):** prompt textarea hard `maxlength="2000"` matching the server schema; double-submit guarded; humanized errors instead of raw Firebase messages.
- **CertUploadCard / IdUploadCard:** `alert()` → toast + humanized error.

### 1.7 Indexes — [firestore.indexes.json](firestore.indexes.json)
- Added `invoices(clientId, issuedAt desc)` — `listClientInvoices` would have thrown FAILED_PRECONDITION on first run.
- Added `invoices(tradespersonId, issuedAt desc)` — covers `subscribeTradieInvoices` when no status filter is applied.
- Added `clientReviews(clientId, createdAt desc)` — `listClientReviewsFor` would have failed.

### 1.8 Verification
- ✅ `npm run lint` — passes (no warnings)
- ✅ `npm run build` — passes (vue-tsc + vite, no errors)
- ✅ `npm --prefix functions run build` — passes (TS strict)
- ✅ `npm run test:run` — passes

---

## 2. Findings inventory (full list)

Severities follow the audit-agent convention: CRITICAL = security/privacy hole or data corruption risk that ships today; HIGH = exploitable abuse, integrity damage, or design contract violation; MEDIUM = bug, drift, or quality issue worth doing soon; LOW = polish.

### 2.1 Security rules (Firestore + Storage)

| ID | Severity | Area | Issue | Status |
|---|---|---|---|---|
| C1 | CRITICAL | rules-firestore | `users/{uid}` world-readable via `resource.data.role == 'tradesperson'` clause leaked email/phone/Stripe | ✅ fixed |
| C2 | CRITICAL | rules-firestore | Public reviews readable regardless of `hidden` / `flagged` status | ✅ fixed |
| C3 | CRITICAL | rules-firestore | `chats.create` doesn't verify the referenced `jobs/{jobId}` exists or that both parties actually have a job together | ⚠️ partial — move chat creation server-side for full coverage |
| C4 | CRITICAL | rules-firestore | `noServerFieldsTouched(...)` didn't detect deletions; user could `deleteField()` server-managed fields | ✅ fixed via positive equality |
| C5 | CRITICAL | rules-firestore | Rejected tradies could self-resurrect to `pending`; approved tradies could self-yank to `draft`; verifiedTrades/isVisible mutable by owner | ✅ fixed |
| C6 | CRITICAL | rules-firestore | Job parties could rewrite `clientId`, `tradespersonId`, `chatId`, `createdAt`, `trade` | ✅ fixed; clients also blocked from `privateNotes` |
| C7 | CRITICAL | mixed | Public tradesperson doc carries exact `location` GeoPoint + home `primaryAddressText`. Portfolio is world-readable even after `isVisible: false` | 🔜 deferred — needs `tradespeople/{uid}/private/operational` subcollection split; storage rule for portfolio could consult `tradespeople.isVisible` (see § 3.2) |
| C8 | CRITICAL | csp | `script-src 'unsafe-inline'` allows full XSS bypass | ⚠️ partial — other directives tightened; nonce/hash approach for inline scripts queued (§ 3.1) |
| C9 | CRITICAL | rules-storage | Any signed-in user could write to any `jobs/*/intake/` or `chats/*` path | ✅ fixed — party check via `firestore.get(...)` |
| C10 | CRITICAL | rules-storage | Invoices PDF readable by any signed-in user | ✅ fixed |
| H1 | HIGH | rules-firestore | Invoice creation/update unrestricted: tradies could mint invoices for anyone, edit invoice number, flip status | ✅ fixed |
| H2 | HIGH | rules-firestore | `bookings` collection has no service file; rule lets a tradie write but client can't read their own | 🔜 deferred — feature is half-built (see § 4) |
| H3 | HIGH | rules-firestore | `clientReviews` readable by every tradie regardless of relationship to the client | ⚠️ partial — locked to author + admin; cross-tradie "have you worked with this client" read remains future work |
| H4 | HIGH | rules-firestore | Public reviews could be posted without an existing/completed job, no rating bounds, no dedup | ✅ fixed (job + parties + status check, rating bounds, status-active) |
| H5 | HIGH | rules-firestore | Client reviews same problem | ✅ fixed |
| H6 | HIGH | csp | `img-src 'self' data: blob: https:` allowed exfil via any HTTPS host | ✅ fixed (allowlist) |
| H7 | HIGH | csp | Missing `frame-ancestors`, `base-uri`, `form-action`, `object-src` | ✅ fixed |
| H8 | HIGH | rules-storage | MIME-only check on uploads — `contentType: image/webp` claim trusted | ✅ fixed via paired extension regex (defense-in-depth; Cloud-Function-side magic-byte check still recommended) |
| H9 | HIGH | rules-storage | 10 MB ceiling on chat/intake uploads (large enough to drain quota) | ✅ fixed — 4 MB for chat/intake, 10 MB for cert/ID PDFs |
| H10 | HIGH | rules-firestore | `messages.create` didn't lock `type` (`system` forgeable), `text.size`, `createdAt` | ✅ partial — `type` and text size locked; `createdAt` will need a small follow-up for full lockdown |
| H11 | HIGH | rules-firestore | `users.create` allowed arbitrary extra fields | ✅ fixed via `keys().hasOnly([...])` |
| H12 | HIGH | rules-firestore | `idVerifications.create` didn't require `isTradie()` claim | ✅ fixed |
| H13 | HIGH | rules-firestore | Certifications.create didn't require `reviewedBy/At` to be null | ✅ fixed |
| M1–M3 | MEDIUM | headers | Missing CORP, X-Permitted-Cross-Domain-Policies, CSP report-uri | ✅ first two added; report-uri left until a collector exists |
| M4 | MEDIUM | csp | Wildcard `*.googleapis.com` in connect-src | ✅ fixed |
| M5 | MEDIUM | csp | `*.cloudfunctions.net` / `*.run.app` in script-src | ✅ fixed |
| M6 | MEDIUM | headers | Permissions-Policy too narrow | ✅ expanded |
| M7–M9 | MEDIUM | indexes | Missing composite indexes for invoices & clientReviews | ✅ added |
| M10 | MEDIUM | indexes | Unused `(isVisible, trades CONTAINS, ratingAvg)` index | 🔜 deferred — wire the trade filter into the geohash query, or drop the index |
| M11 | MEDIUM | rules-firestore | `users.create` didn't require `termsAcceptedAt` / `termsAcceptedVersion` | ✅ fixed (version required; timestamp is server-stamped, see § 3.3) |
| M12 | MEDIUM | rules-firestore | Chat identity fields could be rewritten post-create | ✅ fixed |
| L1–L7 | LOW | misc | COOP weakening for Google popup, Referrer-Policy strictness, `style-src 'unsafe-inline'`, frame-src too broad, tradie can create at vettingStatus 'pending', etc. | 🔜 deferred (documented) |

### 2.2 Cloud Functions

| ID | Severity | Issue | Status |
|---|---|---|---|
| #1 | HIGH | Every callable has `enforceAppCheck: false` | ⚠️ deferred — flipping breaks the app until App Check is wired client-side (App Check init + provider/key). Tracked as the single biggest pre-launch fix. See § 3.5 |
| #2, #15, #35 | HIGH | No rate limiting on AI, sendInvoice, mail-enqueuing endpoints (cost runaway risk) | 🔜 deferred — Firestore token-bucket recipe outlined in § 3.6 |
| #4 | CRITICAL | `setAdminRole` didn't check target user exists; merged claims wrong | ✅ fixed |
| #5 | HIGH | `setAdminRole` non-transactional claim+doc write | ✅ fixed (Firestore-first with rollback) |
| #8 | MEDIUM | No paired `revokeAdminRole` callable | 🔜 deferred |
| #10–#13 | MEDIUM | `setRoleOnSignup` trusts the client-supplied role doc field; first claim missing requires sign-out / token refresh | 🔜 deferred — defense-in-depth: route signup through callables `signUpAsClient` / `signUpAsTradesperson` |
| #14 | HIGH | AI: `enforceAppCheck: false`, see #1 | ⚠️ deferred |
| #16 | HIGH | AI: prompt injection via `prompt` concatenated raw into system context | 🔜 deferred — needs delimited "user instruction" framing |
| #17 | MEDIUM | AI: no job-status guard (can burn tokens on cancelled jobs) | 🔜 deferred |
| #18, #19 | MEDIUM | AI: PII leak to Vertex (full intake + chat sent unredacted); intake photo URLs not validated to belong to this job's Storage path | 🔜 deferred — needs URL allowlist + redactor; documented for privacy policy update |
| #21 | MEDIUM | AI: hard-coded `image/jpeg` MIME but uploads are WebP | ✅ fixed (mime derived from extension) |
| #22 | MEDIUM | AI: Vertex errors returned as fake success content with raw error text | ✅ fixed (now throws HttpsError without leaking provider message) |
| #29, #32 | HIGH | `onJobCompleted` idempotency race could double-create invoices and double-bump `nextInvoiceNumber` | ✅ fixed (deterministic doc id) |
| #31 | MEDIUM | Invoice year stamped using `us-central1` server time | ✅ fixed (Toronto TZ) |
| #34 | HIGH | `sendInvoice` re-sent regardless of status | ✅ fixed (only `draft`/`overdue` allowed; non-zero total required) |
| #36, #38, #62, #63 | MEDIUM/HIGH | Mail abuse vectors — unbounded `paymentInstructions`/`notes`/`reason` text in subject/body; client email unverified | ✅ partial — mail.ts now length-caps + validates `to`; `decisions.ts` notes/reason capped. Unverified `clientEmail` use in `sendInvoice` still a refinement target |
| #37 | MEDIUM | 30-day Storage signed URL on invoice PDF (link-leak risk) | 🔜 deferred — shorten to 24h with on-demand refresh |
| #39 | MEDIUM | PDF rendering unescaped, no length/range caps on line items | 🔜 deferred — wire `lineItemSchema` Zod check into `sendInvoice` callable too |
| #42, #43 | MEDIUM | `scheduledOverdue.ts` unbounded scan, no idempotency on flip, no notification | 🔜 deferred — paginate + check `status !== 'overdue'` before update |
| #45 | HIGH | Stripe webhook stub returned 200 with no signature | ✅ fixed (returns 503 until secret set) |
| #46, #47, #50 | HIGH | `adminToggleSubscription` non-canonical (no Zod, no audit, no role check on target) | ✅ fixed |
| #51, #54, #56 | HIGH | Review aggregation triggers trusted unbounded `rating` and arbitrary `dimensions` keys | ✅ fixed |
| #52, #55 | HIGH | Review triggers didn't verify the reviewer–reviewee relationship via a job | ✅ partial — covered at the rule layer via the new H4/H5 check on create; trigger remains best-effort if rules are bypassed by Admin SDK |
| #58 | MEDIUM | `ping` callable unauthenticated | 🔜 deferred — remove or gate |
| #61 | HIGH | `decisions.ts` updates without existence check; generic INTERNAL on missing doc | ✅ fixed via `requireTradieExists()` |
| #67, #69 | MEDIUM | `onCertApproved` / `onIdApproved` are `onDocumentUpdated` only — direct-create with `approved` status doesn't fire | 🔜 deferred — mirror with onDocumentCreated |
| #70 | MEDIUM | `onIdApproved` doesn't reverse `idVerified` if ID is revoked | 🔜 deferred |
| #71 | HIGH | `scheduledIdRetention` parsed an attacker-influenced `fileUrl` and deleted that path with admin privileges | ✅ fixed (path must start with `tradespeople/{uid}/id/`) |
| #72 | MEDIUM | Retention sweep overwrote `documentType` to `drivers_license` | ✅ fixed |
| #75, #44 | LOW | Scheduled jobs in implicit UTC instead of Toronto | ✅ fixed for retention; #44 (overdue cron) still UTC |
| #76 | HIGH | `submitForVetting` no role check; could be called by clients | ✅ fixed |
| #77, #78 | MEDIUM | `submitForVetting` didn't guard the current `vettingStatus`; counted pending/rejected certs toward coverage | ✅ fixed |
| #79 | MEDIUM | `maybeMarkVisible` read-then-write without transaction (two welcome emails risk) | 🔜 deferred — wrap in transaction |
| #80, #44, others | LOW | CASL footer / unsubscribe link missing on transactional mail | 🔜 deferred |
| #83 | MEDIUM | `enqueueMail` accepted any `to` without validation | ✅ fixed |
| #84 | LOW | `attachments[].path` could be abused to read arbitrary server-local paths | ✅ fixed (removed) |

### 2.3 Frontend (Vue views + components)

| ID | Severity | File | Issue | Status |
|---|---|---|---|---|
| FE-1 | CRITICAL | [LegalDocument.vue:21](src/components/LegalDocument.vue#L21) | `v-html` of marked.parse with no DOMPurify. Today input is `?raw` build-time only, so mitigated, but a single future caller wired to user input becomes XSS | 🔜 deferred — add DOMPurify (needs npm install) and rename component to make trust contract explicit |
| FE-2 | CRITICAL | [ApplicationReviewView.vue:172-176](src/views/admin/ApplicationReviewView.vue#L172) | "ADMIN VIEW ONLY" watermark is a CSS overlay; raw ID URL still opens unwatermarked in a new tab | 🔜 deferred — needs server-rendered watermarked WebP via Cloud Function. Documented in § 3.4 |
| FE-3 | HIGH | [InvoiceEditor.vue:117](src/components/InvoiceEditor.vue#L117) | Cents/dollars unit confusion: typing $100 stored 100¢ = $1 | ✅ fixed |
| FE-4 | HIGH | ChatThread photo URLs not origin-validated | ✅ fixed |
| FE-5 | HIGH | `prompt()` for admin rejection reasons | ✅ fixed (dialog) |
| FE-6 | HIGH | RequestQuoteView Zod unwired; `${uid}-pending` orphan storage path; sequential photo uploads; preview blob URLs never revoked | ✅ fixed |
| FE-7 | HIGH | InvoiceEditor / ReviewPrompt: try/catch with no catch — silent failures | ✅ fixed |
| FE-8 | HIGH | Auth views leak raw Firebase error codes (user enumeration) | ✅ fixed via `humanizeError` |
| FE-9 | HIGH | TradieDashboard `subscribeTradieJobs` race on unmount between async getTradesperson and subscribe | 🔜 deferred — add `cancelled` flag |
| FE-10 | HIGH | `JobDetailView` `privateNotes` field is on `JobDoc` itself, which the client can read | ⚠️ rule-side: client now blocked from updating `privateNotes`, but the **field is still in the doc and the client can read it.** Real fix is to move to `jobs/{jobId}/private/{tradieId}` subcollection. Documented as a follow-up |
| FE-11 | HIGH | `searchTradespeople` has no per-query `limit()` — multiple geohash bounding boxes each pulling unbounded results | 🔜 deferred |
| FE-12 | HIGH | `uploadFile` doesn't enforce WebP client-side; rules + extension regex are the only defense | ⚠️ improved — Storage rule now also checks filename extension. UI-side `uploadImage()` helper still recommended |
| FE-13 | HIGH | Legal version: existing users never re-prompted on `LEGAL_VERSION` bump despite the comment claiming they are | 🔜 deferred — add a guard in `router.beforeEach` + a `recordTermsAcceptance` service. See § 3.3 |
| FE-14 | MEDIUM | SearchView auto-refetches on every coordinate / radius change without debounce | 🔜 deferred |
| FE-15 | MEDIUM | LocationPicker uses deprecated `google.maps.Marker` instead of AdvancedMarkerElement; missing session token on autocomplete (billing) | 🔜 deferred |
| FE-16 | MEDIUM | KanbanBoard min-width 1440px on 375px target | 🔜 deferred — design.md requires mobile-first; needs an accordion view |
| FE-17 | MEDIUM | KanbanBoard has no keyboard a11y on drag | 🔜 deferred |
| FE-18 | MEDIUM | OnboardingWizard: 8-step wizard in a single 486-line file (CLAUDE.md says <200); Zod schemas exist but `canSubmit` is hand-rolled; lat/lng entered as raw numbers despite `LocationPicker` existing | 🔜 deferred — extract per-step components |
| FE-19 | MEDIUM | AiToolsPanel: prompt textarea length cap missing | ✅ fixed |
| FE-20 | MEDIUM | `markRead` accepted a `userId` param the caller could spoof | ✅ fixed (derived from auth) |
| FE-21 | MEDIUM | JobDetailView read tradie's full `users` doc just to get `hasActiveSubscription` (PII over-fetch); also direct Firestore call in view (CLAUDE.md violation) | ✅ fixed |
| FE-22 | MEDIUM | Status dropdown in JobDetailView had no confirm before `complete` / `cancelled` (Kanban did) | ✅ fixed |
| FE-23 | MEDIUM | InvoiceEditor `lineItemSchema` not actually used; no validation before save/send | ✅ fixed |
| FE-24 | MEDIUM | RouterLink wrapping Button anti-pattern in many views (HTML `<a><button>` is invalid) | 🔜 deferred — sweep using PrimeVue's `as="router-link"` |
| FE-25 | MEDIUM | TradieCard / TradieProfileView never show the tradie's `displayName` (uses UID initial in avatar) — `users.displayName` not joined to `tradespeople/{uid}` | 🔜 deferred — denormalize via Cloud Function or join client-side |
| FE-26 | LOW | many | Icon-only buttons missing `aria-label` (chat paperclip, remove-photo, remove-line-item, AvailabilityEditor X, AccountView change-photo) | ⚠️ partial — fixed in InvoiceEditor + RequestQuoteView; sweep remaining |
| FE-27 | LOW | many | `alert()` errors across cert/ID upload | ✅ fixed |
| FE-28 | LOW | SearchView `redirect` query param taken as raw string | 🔜 deferred — sanitize to `/`-prefixed paths |
| FE-29 | LOW | LegalDocument string-hack `replaceAll('href=…')` instead of marked configuration | 🔜 deferred |

### 2.4 Services + validation + auth

Auth races, schema casts, query gaps — most fixed via the changes above. Items still open:

- **Auth race / Google first-signup window** (Finding 1.3 from agent 4): `onAuthStateChanged` fires before `createUser` resolves; for the duration `auth.role === null` and the user lands on Home. 🔜 deferred — make `signInWithGoogle()` set state synchronously after `createUser`.
- **`signInWithGoogle` defaults `intendedRole` to `client`** — if the tradie sign-up page calls it without an explicit role, the user is silently a client. 🔜 deferred — make `intendedRole` required (no default).
- **`Date` → `Timestamp` double-casts** (`as unknown as never`) in `createJob`, `scheduleJob`, `createCertification`. 🔜 deferred — `Timestamp.fromDate(...)` at the service boundary; remove the casts.
- **`serverTimestamp() as never`** scattered throughout. 🔜 deferred — define a `WithFieldValue<T>` write-model helper.
- **`subscribeTradieJobs` / `subscribeClientJobs`** don't reset when `auth.fbUser` changes. 🔜 deferred — watch and re-subscribe.
- **`searchTradespeople`** still does per-query unbounded fetches. 🔜 deferred — `fbLimit(50)` per geohash bound.
- **`getTradesperson` returns full doc** including `vettingNotes` + `paymentInstructions`. 🔜 deferred — split into public + private subcollections.

---

## 3. Major follow-up tracks (cross-cutting work, not one-line fixes)

### 3.1 Drop `'unsafe-inline'` from `script-src`
This is the single biggest hardening win still on the board. The blocker is that Vite emits a small inline bootstrap. Two paths:
1. **Hash mode:** `vite-plugin-csp` or manual SHA-256 of the inline blob, listed as `'sha256-…'` in the directive.
2. **Nonce mode:** more complex on Firebase Hosting (static headers can't issue per-request nonces); would need a Cloud Functions / Cloud Run-served `index.html` that injects a nonce, OR a build step that emits a stable, content-addressable inline.

Recommended: hash mode, since the bootstrap content is build-stable.

### 3.2 Split tradesperson doc into public + private
Today's `tradespeople/{uid}` carries `vettingNotes`, `paymentInstructions`, `nextInvoiceNumber`, `geohash`, exact `location`, `primaryAddressText`. World-readable when `isVisible: true`. Move to:
- `tradespeople/{uid}` — public projection: `bio`, `trades`, `pricingModel`, `hourlyRate`, `providesFreeQuotes`, `serviceRadiusKm`, `portfolioPhotos`, `ratingAvg/Count/Dimensions`, `verifiedTrades`, `idVerified`, `weeklyAvailability`, `geohash` (intentionally coarse), city/region only (not full address).
- `tradespeoplePrivate/{uid}` — owner + admin: `vettingNotes`, `paymentInstructions`, `nextInvoiceNumber`, exact `location` GeoPoint, `primaryAddressText`.

Update `searchTradespeople`, profile view, and onboarding to read/write from the right collection.

### 3.3 Legal version re-prompt
- Add `recordTermsAcceptance(uid, version)` to `services/users.ts`.
- In `router.beforeEach`, after `auth.init()`, if `auth.user && auth.user.termsAcceptedVersion !== LEGAL_VERSION`, redirect to a new `/accept-terms` route that accepts and writes the new version.
- For Google sign-in's first-signup flow, require the checkbox on a completion screen before writing the user doc.

### 3.4 Server-rendered watermark on admin ID viewer
- Add a callable `getWatermarkedId(tradieUid)` that loads the Storage object, composites "ADMIN VIEW ONLY · <reviewer email> · <ISO timestamp>" onto pixels (sharp / canvas), returns a short-lived signed URL or base64 blob.
- Render `<img>` against that response only. Remove the `<a href=raw>` wrapper. Also disable right-click + drag on the image element.

### 3.5 App Check
- Add `firebase/app-check` init to `src/firebase/config.ts` with the reCAPTCHA Enterprise provider.
- Flip every callable to `enforceAppCheck: true` (and `consumeAppCheckToken: true` on state-changing endpoints to prevent replay).
- Document the App Check site key in `.env.example`.
- Note: Until the client init exists, leaving callables at `enforceAppCheck: false` is the lesser evil — flipping prematurely breaks all callables.

### 3.6 Rate limits on cost-impacting callables
Cheap pattern: a `rateLimits/{uid}_{fn}` doc with `count`, `resetAt`. Increment on each call, refuse if over budget, atomic via transaction. Targets:
- `aiDiagnose` / `aiQuote` / `aiSummarize` — e.g. 50/day, 200k tokens/day per user.
- `sendInvoice` — e.g. 30/day, 1 every 60s per invoiceId.
- Mail enqueues (via `lib/mail.ts`) — caller-aware (not global).

### 3.7 Move privateNotes / chat creation / status transitions to Cloud Functions
- `privateNotes` should live in a tradie-only subcollection so the client physically cannot read it (FE-10).
- `createJob` + `createChat` should be one atomic callable so there's no half-built chat / no orphan `${uid}-pending` storage path.
- Status transitions (`updateJobStatus`) should be a callable with an explicit transition table (`requested → quoted → scheduled → in_progress → awaiting_payment → complete`) — the rules-side check is hard to express cleanly.

### 3.8 PrimeVue + accessibility sweep
- Replace every `<RouterLink>…<Button/></RouterLink>` with `<Button as="router-link" to="…">` to fix invalid `<a><button>` nesting.
- Add `aria-label` to every icon-only `Button`.
- Use `<label for="…">` linkage in `IntakeFormRenderer` (currently siblings).
- Kanban: provide a "Move to column" `<Select>` per card for keyboard users.
- Kanban mobile: collapse the 6-column 1440px-wide grid into a stacked-by-status accordion at <768px.

### 3.9 Cents/dollars hygiene across the rest of the codebase
The bug fixed in InvoiceEditor exists in spirit everywhere money flows — make sure every `unitPrice` / `hourlyRate` field is consistently in cents at the storage layer, and add a comment to the `LineItem` and `TradespersonDoc` interfaces clarifying the unit.

---

## 4. User stories — design coverage walk

For each role, the stories below are the "happy path the user expects" plus the obvious edge cases. ✅ = supported today; ⚠️ = partial / has a known issue; ❌ = unsupported (design gap).

### 4.1 Client stories

| As a client, I want to… | Status | Notes |
|---|---|---|
| Sign up with email/password and agree to terms | ✅ | terms acceptance recorded with version |
| Sign up with Google | ⚠️ | terms checkbox not enforced before popup (FE-13 / agent finding 11.3) |
| Search tradespeople near me by trade, distance, rating, availability | ⚠️ | trade + distance + rating done; "available this week" not implemented; no debounce on map drag (FE-14) |
| See a tradie's verified badges, ratings, reviews, portfolio, calendar | ⚠️ | profile shows trades + rating + bio; portfolio + calendar present; per-dimension breakdown shown; **tradie's display name not shown** (FE-25) |
| Submit a job request with photos + intake form | ✅ | Zod-validated; photos parallel upload; postal code normalized |
| Chat with the tradie about the job (text + photo) | ✅ | photo origin validated; markRead derived from auth |
| Schedule a date | ✅ | tradie writes the schedule; client sees it |
| Pay an invoice | ⚠️ | invoice viewable + downloadable; "Mark paid" is the tradie's button; no client-initiated payment in MVP (design says v1.1 Stripe Connect) |
| Review the tradie | ✅ | with rule-enforced job-completion check |
| Read other clients' reviews | ✅ | only `status: active` reviews are public now |
| Re-accept updated terms when LEGAL_VERSION bumps | ❌ | comment claims this but no code does it (FE-13) |
| Dispute a review (per design 4.4) | ❌ | not implemented |
| Receive a 14-day reminder to leave a review | ❌ | scheduled function not implemented |
| Add a photo of my issue while chatting | ✅ | |
| See whether the tradie I requested is verified | ✅ | `verifiedTrades` + `idVerified` shown |
| Find out the tradie isn't responding | ❌ | no SLA, no response timer, no admin alert |
| Cancel a request before the tradie accepts | ⚠️ | status transitions allow `cancelled` but no client-facing "cancel" button audited |

### 4.2 Tradesperson stories

| As a tradesperson, I want to… | Status | Notes |
|---|---|---|
| Sign up and start the onboarding wizard | ✅ | terms checkbox enforced |
| Pick primary + secondary trades, set years of experience | ✅ | now enum-bounded |
| Set my pricing model | ✅ | enum + hourly rate validation |
| Pin my service area on a map with a radius slider | ❌ | wizard step still has manual lat/lng input (FE-18) despite `LocationPicker` existing |
| Set my weekly availability | ✅ | |
| Upload a certification per trade and an ID | ✅ | size + MIME + extension enforced |
| Submit my application; see status | ✅ | status check now blocks re-submit |
| Resume the wizard after closing the tab | ✅ | draft loads in `onMounted` |
| Receive an email when admin requests info / rejects / approves | ✅ | via `decisions.ts` + `visibility.ts` |
| See "you're live" on the dashboard once approved | ✅ | |
| Manage jobs via Kanban + per-job calendar | ⚠️ | Kanban exists but unusable on mobile (FE-16) and not keyboard-accessible (FE-17) |
| Drag a job to a new column to update status | ✅ | (with status-transition checks at the rules layer) |
| Mark a job complete and have a draft invoice auto-created | ✅ | now deterministically `invoices/{jobId}` |
| Edit invoice line items inline with correct currency math | ✅ | cents/dollars bug fixed |
| Send an invoice via PDF email | ✅ | status guard added |
| Mark an invoice paid | ✅ | |
| See if a client has paid | ❌ | no client-driven payment confirmation flow in MVP (manual mark-paid only) |
| Use AI Diagnose / Quote / Summary | ⚠️ | works; subscription-gated; **no rate limit**; prompt-injection vector open |
| Take a private note on a job | ⚠️ | works for me but the client can read the field (FE-10) — needs subcollection move |
| Receive a private review (the client → me) | ✅ | |
| Review the client privately | ✅ | rule-enforced |
| See other tradies' private reviews of clients I'm about to take on | ❌ | currently restricted to author-only reads — broader access needs the "have-you-worked-with" denormalization (H3) |
| Set my payment instructions / e-transfer details | ⚠️ | works; stored on `tradespeople/{uid}` so it's world-readable when visible. Move to private subcollection (§ 3.2) |
| Get reminded to follow up on an unresponded request | ❌ | no SLA enforcement |
| Block off a vacation week on my calendar | ❌ | `bookings` collection rules exist but no service / UI (H2) |

### 4.3 Admin stories

| As an admin, I want to… | Status | Notes |
|---|---|---|
| See the pending vetting queue sorted by oldest | ✅ | |
| Open an application and see cert + ID side-by-side | ✅ | |
| See a watermarked ID document | ❌ | watermark is overlay-only; raw URL is one click away (FE-2 / § 3.4) |
| Approve a cert, reject with reason | ✅ | rejection now goes through a dialog |
| Approve / Request Info / Reject the whole application | ✅ | reason length-capped |
| Get audit-logged every action | ✅ | |
| Promote another user to admin | ✅ | now verifies target exists, atomic |
| Revoke admin | ❌ | (#8) needs a paired callable |
| Suspend an account / hide a review (per design 5.10) | ❌ | not implemented |
| Investigate a job/chat for a support ticket | ⚠️ | rules let admin read; no admin job-detail UI specifically |
| See platform metrics dashboard | ❌ | not built |
| Flip a tradie's subscription on/off (until Stripe lands) | ✅ | now audit-logged + canonical pattern |
| See and process refunds | ❌ | not in MVP scope |
| Edit intake form schemas via UI | ❌ | per design, "admin UI for editing comes later" (5.3) |

### 4.4 System / background flows

| Flow | Status | Notes |
|---|---|---|
| `setRoleOnSignup` mirrors role to claim | ⚠️ | trusts client-supplied role on doc (#10); fine while rules restrict the values, but defense-in-depth would be a callable signup |
| `onCertApproved` / `onIdApproved` update `verifiedTrades` / `idVerified` and conditionally flip `isVisible` | ⚠️ | only on update; direct-create with `approved` is silent (#67/#69) |
| `onJobCompleted` drafts an invoice | ✅ | deterministic, idempotent |
| `onMessageCreated` bumps chat metadata + recipient unread | ⚠️ | recipient calc assumes sender is one of the two parties (admin-sent system messages mis-bump) |
| `scheduledIdRetention` purges ID files >90 days post-approval | ✅ | path-traversal hardened, TZ-pinned |
| `scheduledOverdue` flips invoices to overdue daily | ⚠️ | works but unbounded scan, UTC schedule, no notification |
| `stripeWebhook` handles subscription events | ❌ | stubbed; webhook stub now 503 until secret set |
| 14-day review window auto-closes the job | ❌ | not implemented |
| `auditLog` written from every admin action | ✅ | |
| `mail` collection writes consumed by Trigger Email extension | ⚠️ | extension may not yet be installed; mail.ts validates + caps content |

### 4.5 Cross-cutting design gaps

These are gaps **in `design.md` itself** that the audit surfaced:

1. **Review window enforcement (§ 4.4):** design says "14-day window. After that, the job auto-closes with no review." No scheduled function, no `reviewWindowExpiresAt` field on the job, no `reviewed` → `closed` transition. Add a scheduled function + field.
2. **Booking calendar (§ 5.4):** `bookings` collection in the data model + rules; no service file, no UI surfaces it. Either build it (vacations / one-off blocks) or remove it from design.
3. **PrivateNotes leakage:** design says "Private notes (tradie-only)" but stores them on the parent job doc that the client reads. Spec needs an explicit "stored in `jobs/{jobId}/private/{tradieId}` subcollection" note.
4. **PII scope of `tradespeople/{uid}` (§ 6):** `primaryAddressText` (potentially a home address), exact `location` GeoPoint, `paymentInstructions`, `vettingNotes` all live on a doc that's world-readable when `isVisible: true`. Design should split into public + private projections, or constrain what goes on the public side.
5. **Re-acceptance of terms:** design mentions LEGAL_VERSION but doesn't specify the UX flow when it bumps for existing accounts. Add a section to § 11 (Working Agreements) or § 4.
6. **Tradesperson display name on profiles/cards:** `users.displayName` is on the user doc but never joined to `tradespeople/{uid}`. Spec needs a denormalization rule (Cloud Function on user update or read-time join).
7. **App Check init flow:** design says "All callable functions must enforce App Check" (§ 8). Reality: every callable today has `enforceAppCheck: false`. Either turn it on (after client init) or admit it's deferred and put a release-gate next to launch.
8. **Rate limiting:** design § 5.9 says AI tools are "subscription-gated" but doesn't cap usage. With pay-per-token Vertex billing, a single bad-actor tradesperson with a stolen subscription can be expensive. Spec should add a per-user-per-day token cap.
9. **Review aggregation integrity:** design doesn't say what happens to `ratingAvg` when a review is later `flagged` / `hidden`. The aggregation is one-way; flagging a malicious 1-star review doesn't refund the rating.
10. **Job-status transition matrix:** § 4.2 says "Drag between columns updates status" but doesn't define which transitions are legal for which role. Clients shouldn't be able to mark `complete`. The Kanban only confirms on `complete`; everything else is unguarded.
11. **Phone verification at signup (§ 14 open question 3):** still unanswered. Affects spam tradie applications.
12. **Trade-licensing source of truth (§ 14 open question 5):** still free-text `issuingBody`. Region-specific structured lists would help admin throughput.
13. **Multi-tab signout sync:** if user signs out in tab A, tab B keeps the old session until next auth state event. Not in spec; minor.
14. **What happens when a tradie deletes their account?** No spec for cascade behavior (orphan jobs/reviews/invoices). Admin-only delete today; design should cover this before launch.
15. **Insurance / WCB coverage proof (§ 12 v1.1):** Canadian trades typically need WCB / insurance — verifies trust but not in MVP. Worth surfacing in onboarding copy even before the upload exists.
16. **Chat moderation:** chat is "immutable for legal accountability" but there's no surface for clients/tradies to flag inappropriate messages. Admin can read but there's no `flag` workflow.
17. **Address PII on jobs:** the job address (full street + postal) is readable by both parties + admin. Design doesn't talk about how long the address is retained after `complete`.

---

## 5. Closing notes

Lint, type-check, unit tests, web build, and functions build all pass on the current branch as of the end of this audit. Storage rules and Firestore rules now require the Firebase emulator suite + a security-rules test harness to be reliably regression-tested — design.md § 7 mandates allow + deny tests per rule, but the `tests/rules/` directory referenced there does not exist in the repo. **Adding that harness is the next-most-valuable thing to do** after the items in § 3.

Highest-priority follow-ups for an MVP launch checklist, in order:

1. **App Check init + flip every callable to `enforceAppCheck: true`** (§ 3.5).
2. **Move `privateNotes` to a tradie-only subcollection** so clients physically can't read it (FE-10, § 3.7).
3. **Split tradesperson public/private** (§ 3.2).
4. **Drop CSP `'unsafe-inline'`** via hash mode (§ 3.1).
5. **Server-rendered ID watermark** (§ 3.4).
6. **Rate limits on AI + sendInvoice** (§ 3.6).
7. **Legal version re-prompt** (§ 3.3).
8. **Rules tests in `tests/rules/`** per CLAUDE.md mandate.

Every fix landed in this pass is small, surgical, and either has a failing test in mind or extends an existing pattern. The big-ticket items in § 3 are best done one at a time — each is multi-file and changes a contract.
