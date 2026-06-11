import type { GeoPoint, Timestamp } from "firebase/firestore";

export type Role = "client" | "tradesperson" | "admin";

export type WithId<T> = T & { id: string };

// ---------------------------------------------------------------------------
// users/{uid}
// ---------------------------------------------------------------------------
export interface UserDoc {
  // A user can hold both "client" and "tradesperson" roles ("admin" is layered
  // on top via setAdminRole and is never user-self-selected). `roles` is the
  // authoritative list; `activeRole` is the current view-mode (Airbnb-style).
  // Server-side: rules + callables read `roles`. UI: read `activeRole` for
  // what to render.
  roles: Role[];
  activeRole: Role;
  displayName: string;
  email: string;
  photoURL: string | null;
  phone: string | null;
  // "About me" — free-form short blurb visible on the user's profile tab
  // (everyone) and on the public tradesperson profile (tradies). Optional;
  // legacy users (and clients who haven't filled it in) will have it absent.
  // The tradesperson public profile reads this first and falls back to
  // tradesperson.bio for accounts created before this field existed.
  bio?: string | null;
  createdAt: Timestamp;
  lastActiveAt: Timestamp;
  emailVerified: boolean;
  // clients only:
  clientRatingAvg: number;
  clientRatingCount: number;
  termsAcceptedAt: Timestamp | null;
  termsAcceptedVersion: string | null;
  // PIPEDA: soft delete. When non-null the user is marked for deletion;
  // sign-in checks this and refuses to seat the session. A scheduled
  // function (scheduledHardDelete) wipes the account 30 days after this
  // timestamp. Recovery within the grace window goes via support — there's
  // no self-serve un-delete to keep the deletion path deliberate.
  deletedAt: Timestamp | null;
  // Per-channel notification opt-outs. notify() reads these before fanning
  // to email/WhatsApp; the in-app inbox is always written regardless (it's
  // the source-of-truth audit log). Missing = default-enabled so legacy
  // users (pre-this-field) keep getting notifications until they opt out.
  notificationPrefs: NotificationPrefs;
}

export interface NotificationPrefs {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  // Tradesperson-only: opt out of "new job in your area" broadcasts.
  // Missing = enabled (matches the legacy-friendly default of the other
  // prefs above).
  newJobPostingEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// tradespeople/{uid}
// ---------------------------------------------------------------------------
export type PricingModel = "hourly" | "quote" | "both";
export type VettingStatus =
  | "draft"
  | "pending"
  | "info_requested"
  | "approved"
  | "rejected";

export interface AvailabilityBlock {
  start: string; // "HH:mm"
  end: string;
}

export interface WeeklyAvailability {
  mon: AvailabilityBlock[];
  tue: AvailabilityBlock[];
  wed: AvailabilityBlock[];
  thu: AvailabilityBlock[];
  fri: AvailabilityBlock[];
  sat: AvailabilityBlock[];
  sun: AvailabilityBlock[];
}

export interface RatingDimension {
  avg: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Stripe Connect Express payout state. Mirrored from Stripe by the
// `account.updated` webhook + the `createConnectAccount` callable so search
// + rules + UI can read it as a single Firestore subscription without
// round-tripping to Stripe. Server-managed: every field is locked against
// owner writes by /tradespeople rules.
//
// Lifecycle:
//   not_started → in_progress → restricted | enabled
//                 (account exists but hasn't completed onboarding)
// `enabled` is the only state that lets `maybeMarkVisible(uid)` set
// /tradespeople/{uid}.isVisible = true post-cutover; `restricted` means
// Stripe needs more info from the tradesperson (pendingRequirements).
// ---------------------------------------------------------------------------
export type ConnectOnboardingStatus =
  | "not_started"
  | "in_progress"
  | "restricted"
  | "enabled";

export interface PayoutsState {
  stripeAccountId: string | null;
  onboardingStatus: ConnectOnboardingStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  pendingRequirements: string[];
  lastSyncedAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// Google Business Profile reviews — public snapshot on tradespeople/{uid}
// ---------------------------------------------------------------------------
// A tradesperson can opt in to connect their Google Business Profile (OAuth);
// a Cloud Function then caches their Google rating + a few recent reviews here
// for display on their public profile. This is SERVER-MANAGED (written only by
// the google/* functions; locked in firestore.rules). The long-lived refresh
// token never lands here — it lives encrypted in the server-only
// tradespeople/{uid}/secure/google doc. These Google reviews are shown in their
// own clearly-attributed section and are NEVER merged into the native Blue Seal
// ratingAvg / ratingCount (different provenance, not mutual-blind, not tied to a
// verified Blue Seal job).
export interface GoogleReviewItem {
  reviewId: string;
  authorName: string;
  authorPhotoUrl: string | null;
  rating: number; // 1-5
  comment: string;
  createTime: string; // ISO timestamp from Google
}

export interface GoogleReviewsSnapshot {
  connected: boolean;
  // The Google Business location's title + a link out to its Google listing.
  locationName: string | null;
  profileUrl: string | null;
  // Aggregate across ALL Google reviews (not just the cached slice below).
  rating: number | null;
  reviewCount: number;
  // Most-recent handful, cached for display. The profile links out to Google
  // for the full set.
  reviews: GoogleReviewItem[];
  lastSyncedAt: Timestamp | null;
  // Non-null when the last refresh failed (token revoked, API hiccup) — the UI
  // shows a soft "couldn't refresh" note while keeping any prior data visible.
  syncError: string | null;
}

export interface TradespersonDoc {
  // Denormalized from users/{uid} so the public profile page can show the
  // tradie's name and avatar without needing read access to users (which is
  // owner+admin only). Kept in sync when the user updates their profile.
  displayName?: string;
  photoURL?: string | null;
  // Optional registered business name, e.g. "ABC Mechanical Ltd." Sole
  // proprietors leave this null and clients see just the display name.
  companyName: string | null;
  // Languages the tradesperson can work in. Used on the public profile and
  // (eventually) as a search filter. Free-form to allow regional variants
  // ("Cantonese" + "Mandarin" rather than just "Chinese").
  languages: string[];
  bio: string;
  trades: string[]; // canonical keys, primary at [0]
  yearsExperience: Record<string, number>;
  pricingModel: PricingModel;
  hourlyRate: number | null; // cents
  // Optional separate rate for billing travel/callout time on hourly jobs.
  // When null, travel falls back to hourlyRate. Never applies to fixed-price
  // jobs — there, travel can only enter via a client-approved extra.
  travelRate: number | null; // cents
  providesFreeQuotes: boolean;
  // PUBLIC, coarse location for discovery. The exact GeoPoint + the home
  // address live in the private subdoc tradespeople/{uid}/private/contact
  // (see TradespersonContact) — they must NOT be on this world-readable doc,
  // or any unauthenticated reader could harvest every vetted tradie's home
  // coordinates. `locationApprox` is the exact point rounded to ~2 decimals
  // (~1.1 km); `geohashPublic` is a length-6 geohash (~1.2 km cell) used for
  // the bounding-box proximity query. Mirrors the public/private split used
  // by jobPosts.addressPublic.
  locationApprox: GeoPoint;
  geohashPublic: string;
  serviceRadiusKm: number;
  portfolioPhotos: string[];
  ratingAvg: number;
  ratingCount: number;
  ratingDimensions: {
    quality: RatingDimension;
    punctuality: RatingDimension;
    communication: RatingDimension;
    value: RatingDimension;
  };
  verifiedTrades: string[];
  idVerified: boolean;
  // Set by the onInsuranceApproved / onWsibApproved Cloud Function triggers.
  // Owner cannot edit these directly; they're sourced from the verification
  // doc in /insuranceVerifications/{uid} or /wsibVerifications/{uid}.
  insuranceVerified: boolean;
  insuranceExpiresAt: Timestamp | null;
  wsibVerified: boolean;
  wsibExpiresAt: Timestamp | null;
  vettingStatus: VettingStatus;
  vettingNotes: string;
  isVisible: boolean;
  weeklyAvailability: WeeklyAvailability;
  nextInvoiceNumber: number;
  // Mirrors nextInvoiceNumber for the quotes collection. Lazily backfilled
  // by submitQuote (defaults to 1) so pre-existing tradesperson docs that
  // predate the quote flow keep working.
  nextQuoteNumber?: number;
  // Customisable prefixes on the generated invoice/quote number stamp. The
  // stamp shape stays `${prefix}-${year}-${0001}` — e.g. setting
  // invoicePrefix to "ACME" gives "ACME-2026-0001". Server-managed via the
  // setInvoiceNumbering callable: prefixes can change anytime (old docs
  // keep their stamped number), but the starting sequence can only be set
  // before the tradesperson issues their first invoice/quote so the
  // counter stays monotonic. Optional only for backwards-compat with
  // pre-cutover tradesperson docs; readers default to "INV"/"Q".
  invoicePrefix?: string;
  quotePrefix?: string;
  paymentInstructions: string;
  // Company logo shown at the top of generated quotes and invoices in
  // place of the Blue Seal wordmark when set. Stored as the public download
  // URL of an upload at `tradespeople/{uid}/logo/...` in Storage. Pulled
  // fresh by the PDF renderer + invoice card UI on every render — changes
  // here propagate to historical invoices too (deliberate: tradies who
  // rebrand want their old invoices to look current if a client
  // re-downloads). Optional/null when the tradesperson hasn't uploaded one.
  companyLogoUrl?: string | null;
  submittedAt: Timestamp | null;
  approvedAt: Timestamp | null;
  // Stripe Connect Express state — mirrored from Stripe via the
  // `account.updated` webhook. Optional only while the data-model migration
  // is rolling out; the `backfillPayoutsField` admin callable seeds the
  // `not_started` default on every approved tradesperson so post-backfill
  // every doc has it. Service code reading this should still default-handle
  // undefined for safety.
  payouts?: PayoutsState;
  // Public "verified earnings" stats — server-incremented in the
  // `payment_intent.succeeded` webhook. Drives a social-proof badge on the
  // public profile ("$50k+ paid through Blue Seal"). Optional because
  // pre-cutover docs don't have it; readers should treat undefined as 0.
  paidJobsCount?: number;
  paidLifetimeCents?: number;
  // Cached Google Business reviews when the tradesperson has connected their
  // Google Business Profile (opt-in). Server-managed; null/absent when not
  // connected. Shown in a separate, attributed section — never folded into the
  // native ratingAvg above. See GoogleReviewsSnapshot.
  googleReviews?: GoogleReviewsSnapshot | null;
}

// Private tradesperson contact details, stored at
// tradespeople/{uid}/private/contact. Read/write restricted to the owner +
// admin in firestore.rules. Holds the data that must NOT be world-readable:
// the exact service-area point and the (often home) address used on
// paperwork. The public tradespeople doc carries only locationApprox +
// geohashPublic for discovery.
//
// `location` is the exact GeoPoint the tradie dropped on the map (used to
// restore the editor pin). `primaryAddressText` is the human-readable label
// for that point (often a home address for sole proprietors). businessAddress
// optionally overrides primaryAddressText on quotes/invoices for tradies who'd
// rather not show their home address; businessPhone is the billing contact
// line; gstNumber is the CRA GST/HST registration shown on invoices. The last
// three are optional/null because not every tradie fills them in.
export interface TradespersonContact {
  location: GeoPoint;
  primaryAddressText: string;
  businessAddress?: string | null;
  businessPhone?: string | null;
  gstNumber?: string | null;
}

// ---------------------------------------------------------------------------
// prospects/{prospectId} — seeded, unclaimed tradesperson listings
// ---------------------------------------------------------------------------
// Seeded from public registries + human-reviewed research (see
// tools/seed-research). These are NOT members: no account, no uid, and they
// live in a separate collection from tradespeople/{uid} on purpose, so they can
// never satisfy the `isVisible == true` (= vetted + approved) invariant that
// search, the public read rule, and the marketplace all depend on. They surface
// in client search via their own `isListed` flag with a "Pending verification"
// badge, and deliberately carry NO trust fields (idVerified / verifiedTrades /
// insurance / wsib / ratings) — there is nothing to render a verified badge
// from.
//
// Lifecycle:
//   listed        — imported, discoverable, no outreach yet.
//   outreach_sent — a real client requested them; the claim invite email went
//                   out (requestProspectOutreach). Still discoverable.
//   claimed       — the person signed up with the matching email;
//                   claimProspect migrated the profile into
//                   tradespeople/{uid} and DELETES this doc. `claimed` is a
//                   transient marker only ever seen mid-trigger.
//   suppressed    — unsubscribed / takedown. isListed=false, never re-imported
//                   (a permanent prospectSuppression tombstone is also written).
//
// PRIVACY: the harvested business email/phone are NOT on this world-readable
// doc — they live in prospects/{id}/private/contact (admin-only). For the
// claim match we keep only `emailHash` (a SHA-256 of the lowercased email) on
// the public doc: enough for claimProspect's equality query, useless for
// harvesting. (Firestore reads are all-or-nothing per doc, so a plaintext email
// on a publicly readable doc would leak — hence the hash.)
export type ProspectStatus =
  | "listed"
  | "outreach_sent"
  | "claimed"
  | "suppressed";

// How we obtained the prospect's data — drives provenance/audit and the CASL
// consent posture. Mirrors the `dataBasis` enum the import file carries.
export type ProspectDataBasis =
  | "open_data"
  | "public_registry"
  | "industry_association"
  | "manual_public_lookup";

export interface ProspectDoc {
  // Discovery subset — mirrors the TradespersonDoc fields that search + the
  // card render, so a prospect card looks like a (badged) tradie card.
  displayName: string;
  // Avatar shown on the card + profile. For seeded listings we don't have a
  // real photo, so the importer fills this with a deterministic generated
  // avatar (initials on a gradient) unless a real image URL was supplied. Null
  // falls back to an initial-circle in the UI.
  photoURL: string | null;
  companyName: string | null;
  bio: string;
  trades: string[]; // canonical keys (src/data/trades.ts), primary at [0]
  yearsExperience: Record<string, number>;
  pricingModel: PricingModel;
  hourlyRate: number | null; // cents
  languages: string[];
  // PUBLIC coarse location only (same split as TradespersonDoc). The exact
  // point is never stored for a seeded listing; harvested email/phone live in
  // the private subdoc.
  locationApprox: GeoPoint;
  geohashPublic: string; // length-6 geohash, same derivation as tradespeople
  serviceRadiusKm: number;
  // Human location label (e.g. "Vernon, BC") + optional public business
  // website. Populated for research-sourced listings; optional on older docs.
  locationLabel?: string | null;
  website?: string | null;
  // Re-hosted "our work" / gallery photos pulled from the business's own site
  // (best-effort — many won't have any). Storage URLs (CSP-allowed).
  portfolioPhotos?: string[];

  // Listing state. `isListed` is the prospect analogue of isVisible, but means
  // "unvetted seeded listing", never "trusted". searchProspects filters on it.
  status: ProspectStatus;
  isListed: boolean;

  // Claim match key — SHA-256 hex of the lowercased prospect email.
  // claimProspect hashes the new user's email and matches on this
  // (the email-claim mechanism, mirroring vouches' toEmail match, but hashed
  // so the address never sits on a world-readable doc).
  emailHash: string;

  // Provenance / CASL. `dataConsentBasis` + `sourceUrl` are the audit trail for
  // the implied-consent (conspicuous-publication) outreach basis;
  // `emailConspicuouslyPublished` gates whether we may ever email this row.
  source: string; // human label, e.g. "City of Kelowna Business Licences"
  sourceUrl: string | null;
  dataConsentBasis: ProspectDataBasis;
  emailConspicuouslyPublished: boolean;
  licenceNumber: string | null;
  importedBy: string; // admin uid
  importedAt: Timestamp;
  // (Unsubscribe token is NOT stored — it's an HMAC(secret, prospectId)
  // recomputed on demand, so it can never leak via this world-readable doc.)

  // Outreach bookkeeping — drives the per-prospect cooldown in
  // requestProspectOutreach so a popular prospect isn't emailed repeatedly.
  lastOutreachAt: Timestamp | null;
  outreachCount: number;
  firstRequestedAt: Timestamp | null;

  // Claim linkage — set transiently by claimProspect just before the doc
  // is deleted; only meaningful if a delete ever fails mid-trigger.
  claimedByUid: string | null;
  claimedAt: Timestamp | null;
}

// Private prospect contact — prospects/{prospectId}/private/contact. The
// harvested public business email/phone we must NOT expose on the world-
// readable prospect doc. Admin-only (firestore.rules). No exact coordinate is
// stored: a seeded listing only ever has the coarse locationApprox.
export interface ProspectContact {
  prospectEmail: string; // plaintext, lowercased
  prospectPhone: string | null;
  website: string | null;
}

// ---------------------------------------------------------------------------
// prospectLeads/{leadId}
// A real client request held against an unclaimed prospect until they sign up.
// Created by requestProspectOutreach; drained into a real job by
// claimProspect when the prospect claims. NOT world-readable — only the
// owning client + admin (firestore.rules).
// ---------------------------------------------------------------------------
export type ProspectLeadStatus =
  | "pending_signup"
  | "claimed"
  | "expired"
  | "cancelled";

export interface ProspectLeadDoc {
  clientId: string;
  clientName: string | null;
  clientPhotoURL: string | null;
  prospectId: string;
  // SHA-256 hex of the lowercased prospect email — the claim trigger drains
  // leads by matching the new user's email hash, so the harvested address never
  // lands on the lead either.
  emailHash: string;
  // Trimmed JobDoc shape so the client's request survives until claim and can
  // be replayed into a real job verbatim.
  trade: string;
  title: string;
  description: string;
  urgency: Urgency;
  address: JobAddress;
  intakeFormData: Record<string, unknown>;
  intakePhotos: string[];
  status: ProspectLeadStatus;
  createdAt: Timestamp;
  // +30d. scheduledProspectExpiry flips still-pending leads to `expired`.
  expiresAt: Timestamp;
  claimedJobId: string | null; // set when the lead becomes a real job
  respondedAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// prospectSuppression/{suppressionKey}
// Permanent opt-out / takedown tombstone. One doc per known identifier (the
// suppressionKey is a hash of email / licence# / externalKey). bulkImport
// checks this BEFORE every write so a removed prospect is never re-imported by
// a later research run. Admin-read / server-write only — it must never leak who
// opted out. NEVER deleted.
// ---------------------------------------------------------------------------
export type ProspectSuppressionReason = "unsubscribe" | "takedown" | "complaint";

export interface ProspectSuppressionDoc {
  reason: ProspectSuppressionReason;
  // The hashed identifier this tombstone matches (e.g. emailHash). Stored for
  // audit; the doc id IS the suppressionKey so lookups are a single get().
  identifier: string;
  createdAt: Timestamp;
  createdBy: string | null; // admin uid, or null for self-serve unsubscribe
}

// ---------------------------------------------------------------------------
// certifications/{certId}
// ---------------------------------------------------------------------------
export type DocStatus = "pending" | "approved" | "rejected";

export interface CertificationDoc {
  tradespersonId: string;
  trade: string;
  issuingBody: string;
  certNumber: string;
  expiresAt: Timestamp | null;
  fileUrl: string;
  status: DocStatus;
  reviewedBy: string | null;
  reviewedAt: Timestamp | null;
  rejectionReason: string | null;
  submittedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// idVerifications/{tradespersonId}
// ---------------------------------------------------------------------------
export type IdDocType = "drivers_license" | "passport" | "provincial_id";

export interface IdVerificationDoc {
  fileUrl: string;
  documentType: IdDocType;
  status: DocStatus;
  submittedAt: Timestamp;
  reviewedBy: string | null;
  reviewedAt: Timestamp | null;
  rejectionReason: string | null;
}

// ---------------------------------------------------------------------------
// insuranceVerifications/{tradespersonId}
// General-liability insurance proof. One doc per tradesperson; uploading a
// new one replaces the prior. Approved → "Insurance Verified" badge on the
// public profile + sets insuranceVerified/insuranceExpiresAt on the
// tradesperson doc (via onInsuranceApproved Cloud Function trigger).
// ---------------------------------------------------------------------------
export interface InsuranceVerificationDoc {
  fileUrl: string;
  insurer: string; // e.g. "Northbridge Insurance", "Zensurance", "APOLLO"
  policyNumber: string;
  coverageAmount: number; // cents (200_000_000 = $2M coverage)
  expiresAt: Timestamp;
  status: DocStatus;
  submittedAt: Timestamp;
  reviewedBy: string | null;
  reviewedAt: Timestamp | null;
  rejectionReason: string | null;
}

// ---------------------------------------------------------------------------
// wsibVerifications/{tradespersonId}
// Provincial workers'-compensation clearance certificate (WSIB Ontario,
// WorkSafeBC, WCB Alberta, etc — naming varies by province but the role is
// the same). Most cert PDFs expire every 60–90 days; the badge auto-hides
// when expiresAt passes (frontend filter) but the admin can also re-submit.
// ---------------------------------------------------------------------------
export type CanadaProvince =
  | "ON" | "BC" | "AB" | "QC" | "MB" | "SK" | "NS" | "NB" | "NL" | "PE" | "YT" | "NT" | "NU";

export interface WsibVerificationDoc {
  fileUrl: string;
  province: CanadaProvince;
  clearanceNumber: string;
  expiresAt: Timestamp;
  status: DocStatus;
  submittedAt: Timestamp;
  reviewedBy: string | null;
  reviewedAt: Timestamp | null;
  rejectionReason: string | null;
}

// ---------------------------------------------------------------------------
// intakeFormSchemas/{trade}
// ---------------------------------------------------------------------------
export type IntakeFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "multiselect"
  | "boolean"
  | "date";

export interface IntakeField {
  key: string;
  label: string;
  type: IntakeFieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  helpText?: string;
}

export interface IntakeFormSchemaDoc {
  trade: string;
  version: number;
  fields: IntakeField[];
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// jobs/{jobId}
// ---------------------------------------------------------------------------
// "accepted" is the entry status for jobs created via the job-board marketplace
// (acceptApplication callable). The client still owes the trade-specific intake
// form; once submitted the job transitions to "requested" and joins the standard
// flow. Direct /request/:uid jobs skip "accepted" and start at "requested".
//
// "awaiting_client_approval" sits between "in_progress" and "awaiting_payment":
// the tradesperson has used the Finish-job flow to draft the invoice, and the
// client is being asked to approve the work before payment is requested. From
// here the client either approves (→ awaiting_payment) or requests changes
// (→ in_progress + reason posted in chat). Both transitions go through
// callables (submitJobForApproval / clientApproveJob / clientRequestChanges)
// so the invoice doc + chat system message stay in lockstep with the status.
//
// Client-quote-accept jumps the job straight from "quoted" to "in_progress" —
// scheduling is metadata (scheduledStart/End) on an active job, not a
// status gate of its own.
// "awaiting_upfront_payment" sits between "quoted" and "in_progress" when the
// accepted quote required an upfront fee. The client accepted the quote but
// work can't begin until the fee is collected; markUpfrontFeePaid /
// clientMarkUpfrontFeePaid advance the job to "in_progress" once it's settled.
// When Stripe Connect is enabled the dispatcher resolves it automatically.
// Pre-existing jobs predate the status entirely; the kanban falls back to the
// generic status label for unknown values via STATUS_LABEL.
// "on_hold" is a client-requested pause on a committed job. The client asks
// (requestJobChange) and the tradesperson accepts (respondJobChange) before the
// status flips here; `statusBeforeHold` records what to restore. Either party
// lifts the hold (resumeJob) — no re-acceptance needed.
export type JobStatus =
  | "accepted"
  | "requested"
  | "quoted"
  | "awaiting_upfront_payment"
  | "in_progress"
  | "on_hold"
  | "awaiting_client_approval"
  | "awaiting_payment"
  | "complete"
  | "reviewed"
  | "cancelled";

// A client-initiated cancel/postpone request on a committed job, awaiting the
// tradesperson's accept/decline. Lives on JobDoc.pendingChange (null when none).
// Written only by the requestJobChange callable; cleared by respond/withdraw.
export interface JobChangeRequest {
  type: "cancel" | "postpone";
  // uid of the party who asked. Client-initiated in the MVP, but stored as a
  // uid (not a role) so the responder/withdraw logic stays symmetric if
  // tradesperson-initiated requests are added later.
  requestedBy: string;
  requestedAt: Timestamp;
  reason: string;
  // postpone only — optional client-proposed resume date (UTC midnight).
  // Informational: surfaced in the request notification + chat line, not a
  // scheduling commitment.
  proposedResumeAt?: Timestamp | null;
}

export type Urgency = "flexible" | "this_week" | "urgent";

export interface JobAddress {
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  geo: GeoPoint | null;
}

export interface JobDoc {
  clientId: string;
  tradespersonId: string;
  // Denormalized at job-creation time so each party can render the
  // counterparty's name + avatar on dashboard cards without a cross-account
  // user-doc read (users/{uid} is owner+admin only). Optional — jobs created
  // before this field was added leave them undefined; the UI falls back to a
  // generic label + initial-circle avatar.
  clientName?: string | null;
  clientPhotoURL?: string | null;
  tradespersonName?: string | null;
  tradespersonPhotoURL?: string | null;
  status: JobStatus;
  trade: string;
  title: string;
  description: string;
  // Trade-specific questionnaire answers (keyed by IntakeField `key` — see
  // src/data/intakeSchemas.ts). Direct-booked jobs populate this from the
  // intake form on creation. Marketplace-originated jobs (sourcePostId set)
  // copy it from the source post's intakeFormData on acceptance, so the
  // detail captured up-front carries through to the job brief. May be {} for
  // a trade with no questionnaire, or for legacy marketplace jobs created
  // before the post-intake change.
  intakeFormData: Record<string, unknown>;
  intakePhotos: string[];
  address: JobAddress;
  preferredDateWindow: { start: Timestamp | null; end: Timestamp | null };
  urgency: Urgency;
  scheduledStart: Timestamp | null;
  scheduledEnd: Timestamp | null;
  createdAt: Timestamp;
  completedAt: Timestamp | null;
  // Set by submitJobForApproval when the tradesperson sends the wrapped-up
  // job to the client. Cleared back to null on clientRequestChanges so a
  // subsequent re-submit shows a fresh timestamp.
  clientApprovalRequestedAt: Timestamp | null;
  // Set by clientApproveJob — locks in the moment the client signed off so
  // any later dispute can reference the approval timeline.
  clientApprovedAt: Timestamp | null;
  // Set by clientRequestChanges when the client kicks the wrap-up back to
  // the tradesperson with a change request. Drives the tradesperson-side
  // "client requested changes" banner + the "Update invoice" CTA. Cleared
  // by the next submitJobForApproval so the loop can repeat cleanly.
  // Optional because pre-existing jobs may not have the field.
  clientChangesRequestedAt?: Timestamp | null;
  clientChangesRequestedReason?: string | null;
  cancelledAt: Timestamp | null;
  cancelledReason: string | null;
  // uid of the party who cancelled — used by onJobCancelled trigger to pick
  // the recipient of the notification (always the opposite party). Null
  // before cancellation, and on pre-existing jobs that were cancelled via
  // the tradesperson status dropdown before this field existed.
  cancelledBy: string | null;
  // Outstanding client cancel/postpone request awaiting the tradesperson's
  // response. Null when there's none. Server-managed: only the requestJobChange /
  // respondJobChange / withdrawJobChange callables (admin SDK) touch it — the
  // rules block parties from writing it directly. Optional: pre-existing jobs
  // predate the field; readers treat undefined as null.
  pendingChange?: JobChangeRequest | null;
  // The status to restore when a held job resumes. Set alongside
  // status === "on_hold" by respondJobChange; cleared by resumeJob. Null/absent
  // at every other point. Server-managed like pendingChange.
  statusBeforeHold?: JobStatus | null;
  chatId: string;
  // Set when this job was created via the job-board marketplace conversion.
  sourcePostId: string | null;
  // Per-party user-initiated archive. Each party can hide a job from their
  // own dashboard's default list without affecting the other side's view —
  // the underlying job doc and its chat/invoice/etc remain intact. Rules
  // enforce that each party can only set/clear their own field. Optional
  // because pre-existing jobs predate the fields; readers treat undefined
  // as null (= not archived).
  clientArchivedAt?: Timestamp | null;
  tradespersonArchivedAt?: Timestamp | null;
  // Quote-required upfront fee, snapshotted from the quote at accept time
  // (clientAcceptQuote). When present and `paidAt` is null, the job sits in
  // status "awaiting_upfront_payment" — markUpfrontFeePaid (tradesperson) or
  // clientMarkUpfrontFeePaid (client) advances it to "in_progress" and stamps
  // paidAt + paidBy. `paymentMethod` mirrors InvoiceDoc — "manual" for the
  // mark-paid path, "stripe" once Connect goes live (the webhook dispatcher
  // resolves it automatically and sets paidBy = "stripe"). `appliedInvoiceId`
  // is back-linked by onJobCompleted when the auto-drafted invoice consumes
  // the credit, so a second invoice can never double-apply it.
  upfrontFee?: UpfrontFeeState | null;
  // How this job is billed, stamped server-side at quote-acceptance from the
  // accepted quote's line items: "hourly" when any line is kind === "hourly",
  // otherwise "fixed". Drives the clock-in UI (fixed jobs track time but show
  // no money) and the rate clock-in snapshots (fixed-job base labour = 0).
  // Optional/null on legacy jobs that predate the field — readers derive it
  // lazily from the quote and treat unknown as "fixed". Server-managed: the
  // rules pin it immutable so a party can't flip their own billing basis.
  billingType?: "hourly" | "fixed" | null;
}

// Tradesperson-private job log, stored at jobs/{jobId}/private/notes so it is
// physically unreadable by the client (the parent job doc is client-readable,
// and Firestore can't filter reads by field). Holds the tradie's free-text
// notes plus the auto-log written by aiUpdateJobLog. Read/write is restricted
// to the assigned tradie + admin in firestore.rules.
export interface JobPrivateNotes {
  notes: string;
  // Watermark for the auto-log feature (aiUpdateJobLog). Updated each time the
  // AI scans new client chat activity and either appends a note or confirms
  // there was nothing log-worthy. The auto-trigger on JobDetailView
  // short-circuits server-side when this is within a 1-hour cooldown.
  lastAutoUpdateAt: Timestamp | null;
}

export interface UpfrontFeeState {
  amountCents: number;
  source: "fixed" | "percent";
  paymentMethod: "manual" | "stripe";
  paidAt: Timestamp | null;
  paidBy: "tradesperson_marked" | "client_marked" | "stripe" | null;
  appliedInvoiceId: string | null;
}

// ---------------------------------------------------------------------------
// jobs/{jobId}/timeEntries/{entryId}
// One row per clock-in / clock-out session. Tradie writes; both parties +
// admin read (the client sees a running timer + the session log, so they
// can sanity-check what they'll be billed for).
//
// `hourlyRateSnapshot` is frozen at clock-in time — a later profile rate
// change doesn't retroactively re-price billed work.
// `endedAt == null` ⇒ the session is currently running. The clockIn
// callable enforces "at most one running entry per job per tradie"
// transactionally; rules can't enforce uniqueness across docs.
// ---------------------------------------------------------------------------
// What a session is clocking against. "labour" is ordinary work on the job
// (billed at the job's hourly rate, or 0 on a fixed-price job — a time-only
// record). "travel" is travel/callout time billed at the tradie's travelRate
// (hourly jobs only). "extra" is work against a client-approved hourly extra
// (jobs/{jobId}/extras/{extraId}); `extraId` points at it. The roll-up groups
// invoice lines by (kind, extraId, rate). Absent on legacy entries ⇒ "labour".
export type TimeEntryKind = "labour" | "travel" | "extra";

export interface TimeEntryDoc {
  tradespersonId: string; // duplicated so rules don't need a job lookup
  clientId: string; // duplicated so rules don't need a job lookup
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  hourlyRateSnapshot: number; // cents — the resolved rate for this kind
  notes: string;
  source: "clock" | "manual";
  // What this session bills against. Optional for back-compat; absent ⇒ "labour".
  kind?: TimeEntryKind;
  // Set only when kind === "extra": the approved extra this time bills against.
  extraId?: string | null;
  invoicedAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// jobs/{jobId}/sessions/{sessionId}
// One booked work visit on this job: a date + start time + end time. A job can
// have MANY sessions (a multi-day job booked across several days). This is the
// tradesperson's plan for when they'll show up; the client reads it so both
// sides see the agreed visits. Distinct from timeEntries (which records work
// that actually happened, for billing) — sessions are future intent.
//
// Mirrors the timeEntries subcollection: both parties read via the PARENT job,
// only the assigned tradesperson writes. The denormalised tradespersonId/
// clientId let the create/update rules avoid a second job lookup.
//
// `start`/`end` are absolute instants (Timestamp), same shape as
// BookingDoc.start/end and JobDoc.scheduledStart/End, so the calendar and
// collision detection compare them directly. The job's scheduledStart/End is
// kept in sync as the "next upcoming" session (see sessions service).
// ---------------------------------------------------------------------------
export interface SessionDoc {
  tradespersonId: string; // duplicated so rules don't need a job lookup
  clientId: string; // duplicated so rules don't need a job lookup
  start: Timestamp;
  end: Timestamp;
  note: string; // optional free text (e.g. "first fix"); "" when none
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// jobs/{jobId}/expenses/{expenseId}
// Tradie-uploaded receipt with markup → invoice line. Receipts are
// considered sensitive (cost-basis, supplier names) — the doc AND the
// underlying file are tradie + admin only. The client only ever sees the
// resulting line item on the invoice once the tradie pulls it in.
//
// `totalCost` is what the tradie paid; `billedAmount` is what the client
// pays (totalCost × (1 + markupPercent/100), rounded; tradie can override).
// `status`: "parsing" while the OCR callable is running, "ready" once
// fields are usable, "invoiced" once pulled into an invoice line item.
// ---------------------------------------------------------------------------
export type ExpenseCategory =
  | "materials"
  | "fuel"
  | "disposal"
  | "parking"
  | "other";

export type ExpenseStatus = "parsing" | "ready" | "invoiced";

export interface ExpenseDoc {
  tradespersonId: string;
  clientId: string;
  description: string;
  vendor: string | null;
  spentAt: Timestamp | null;
  totalCost: number; // cents, what the tradie paid
  markupPercent: number; // 0-200; UI default 15
  billedAmount: number; // cents, line-item amount the client will see
  category: ExpenseCategory | null;
  receiptStoragePath: string | null; // jobs/{jobId}/receipts/{uuid}.{ext}; null = added manually (no receipt)
  status: ExpenseStatus;
  aiParsed: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  invoicedAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// jobs/{jobId}/extras/{extraId}
// A client-approved out-of-scope charge added AFTER work starts (not part of
// the original quote). The tradie proposes it (proposeExtra), the client
// approves/declines it up front (respondExtra) — this is the only way hourly
// money enters a fixed-price job. An extra is either:
//   • "flat"   → a one-off amount (flatAmountCents), or
//   • "hourly" → a rate (hourlyRateCents) the tradie clocks time against
//                (timeEntries with kind === "extra" and this extra's id).
// Server-managed: only the proposeExtra / respondExtra / cancelExtra callables
// (admin SDK) write it — rules block parties from forging approval state.
// `invoicedAt` is stamped when the charge is pulled into an invoice line.
// ---------------------------------------------------------------------------
export type JobExtraStatus = "proposed" | "approved" | "declined" | "cancelled";

export interface JobExtraDoc {
  tradespersonId: string; // duplicated so rules don't need a job lookup
  clientId: string; // duplicated so rules don't need a job lookup
  description: string;
  billingType: "flat" | "hourly";
  flatAmountCents: number | null; // set when billingType === "flat"
  hourlyRateCents: number | null; // set when billingType === "hourly"
  status: JobExtraStatus;
  proposedAt: Timestamp;
  decidedAt: Timestamp | null; // when the client approved/declined
  declinedReason: string | null;
  invoicedAt: Timestamp | null;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// jobs/{jobId}/siteVisit/current  (fixed doc id "current" — at most one per job)
// An informal "I need to see it first" agreement reached BEFORE any quote. The
// tradesperson proposes it (proposeSiteVisit) instead of, or before, quoting;
// the client agrees with one tap — no signature, since it's not a work contract.
// Deliberately does NOT change the job status: the job stays "requested"/"quoted"
// and the visit is just an agreement recorded on the side.
//
// The agreed `fee` is a SINGLE optional line item (feeCents 0 = free visit). When
// the tradesperson later opens the quote composer it is PRE-FILLED as a line item
// they keep (charge on top) or delete (waive/credit) — there is no auto-credit.
//
// Server-managed: only the proposeSiteVisit / respondSiteVisit callables (admin
// SDK) write it, so rules block parties from forging the "agreed" state. On the
// job-board path the same doc is seeded as "agreed" by acceptApplication when the
// client accepts a site-visit application (accepting IS the agreement).
// ---------------------------------------------------------------------------
export type SiteVisitStatus = "proposed" | "agreed" | "declined";

export interface SiteVisitFee {
  description: string; // e.g. "Site visit / assessment"
  feeCents: number; // >= 0; 0 = free visit
  taxRate: number; // 0-0.5, single rate
}

export interface SiteVisitDoc {
  tradespersonId: string; // duplicated so rules don't need a job lookup
  clientId: string; // duplicated so rules don't need a job lookup
  fee: SiteVisitFee; // always present; feeCents 0 = free
  proposedDate: Timestamp | null; // optional tradie-proposed visit date (UTC midnight)
  note: string; // "" when none
  status: SiteVisitStatus;
  proposedAt: Timestamp;
  decidedAt: Timestamp | null; // when the client agreed/declined
  declinedReason: string | null;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// jobPosts/{postId} — public-ish posting on the job-board marketplace.
// Vetted tradies can read posts where status === "open"; the post owner
// (client) can always read their own. Exact address, applicationCount, and
// selectedApplicantId all live in the private/meta subdoc to enforce
// bid-blind and address privacy at the rules layer.
// ---------------------------------------------------------------------------
export type JobPostStatus = "open" | "closed" | "cancelled" | "expired";

export interface AddressPublic {
  city: string;
  region: string;
  postalFsa: string; // first 3 chars of Canadian postal code (forward sortation area)
  geohashPublic: string; // ~500m-jittered geohash, length 6
}

export interface AddressPrivate {
  line1: string;
  fullPostal: string;
  geo: GeoPoint;
  geohashExact: string; // length 9
}

export interface BudgetRange {
  min: number; // cents
  max: number;
  currency: "CAD";
}

export interface JobPostDoc {
  clientId: string;
  // Denormalized at post-creation so vetted tradespeople browsing the feed
  // see who they'd be working for without needing read access to /users
  // (which is owner+admin only at the rule layer). Stored as the client's
  // FIRST NAME ONLY — the post is broad-audience (every vetted tradie in
  // radius can read it before any selection), so we trade the full name
  // for less identifying info up-front. Once a tradie is selected the
  // resulting JobDoc.clientName carries the full displayName for the
  // matched pair. Optional — posts created before this field landed leave
  // them undefined; the UI falls back to a generic "Client" + initial
  // avatar (see JobCounterparty.vue).
  clientName?: string | null;
  clientPhotoURL?: string | null;
  status: JobPostStatus;
  trade: string;
  title: string;
  description: string;
  // Trade-specific questionnaire answers captured at post time (keyed by the
  // IntakeField `key` for the post's trade — see src/data/intakeSchemas.ts).
  // Lets applying tradespeople quote accurately without back-and-forth. Optional:
  // posts created before this field, or for a trade with no questionnaire, leave
  // it undefined. Carried onto the converted JobDoc.intakeFormData on acceptance.
  intakeFormData?: Record<string, unknown>;
  photos: string[]; // 1-8 WebP storage paths under jobPosts/{postId}/photos/
  addressPublic: AddressPublic;
  budget: BudgetRange;
  urgency: Urgency;
  preferredDateWindow: { start: Timestamp | null; end: Timestamp | null };
  convertedJobId: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  closedAt: Timestamp | null;
  acceptedAt: Timestamp | null;
  editedAt: Timestamp | null;
}

// jobPosts/{postId}/private/meta — single doc, client + admin read only.
export interface JobPostMetaDoc {
  addressPrivate: AddressPrivate;
  applicationCount: number;
  selectedApplicantId: string | null;
}

// ---------------------------------------------------------------------------
// jobPosts/{postId}/applications/{tradieId}
// Doc id == tradesperson uid → one application per tradie per post (rules-enforced).
// Bid-blind: only the post owner, the applicant themselves, or admin can read.
// ---------------------------------------------------------------------------
// `rejected` is set by the system when the client accepts a *different*
// applicant (bulk reject in acceptApplicationQuote). `declined` is set when the
// client explicitly dismisses *this* applicant with a reason (declineApplication)
// — the card leaves the client's active list and the tradie sees the reason and
// can revise + re-apply. `withdrawn` is tradie-initiated.
export type ApplicationStatus =
  | "pending"
  | "selected"
  | "rejected"
  | "declined"
  | "withdrawn";

export interface ProposedPrice {
  type: "fixed" | "hourly";
  amount: number; // cents
  notes?: string;
}

// A full itemized quote attached to a marketplace application (bid-marketplace
// flow). Same money shape as QuoteDoc minus the doc-lifecycle fields
// (jobId/quoteNumber/status/timestamps) — those are assigned by
// acceptApplicationQuote when the client accepts and the quote is materialized
// as quotes/{jobId}. Totals + the upfront-fee cents are recomputed server-side
// in submitApplication, so the stored values are authoritative.
export interface ApplicationQuote {
  lineItems: LineItem[];
  subtotal: number;
  discount: InvoiceDiscount | null;
  discountAmount: number;
  taxTotal: number;
  total: number;
  currency: string;
  upfrontFee?: QuoteUpfrontFee | null;
  estimatedHours: number | null;
  // When the tradesperson expects to be able to start, and how long the work
  // should take. Optional — applications submitted before these fields landed
  // (and any non-marketplace path) leave them undefined. proposedStartDate is
  // stored at UTC midnight (a calendar date, not an instant) so format it in
  // UTC when displaying. estimatedDuration is free text ("2–3 days").
  proposedStartDate?: Timestamp | null;
  estimatedDuration?: string;
  validUntil: Timestamp | null;
  terms: string;
  noteToClient: string;
}

export interface ApplicationDoc {
  tradespersonId: string;
  postId: string; // duplicated so collectionGroup queries can filter by post
  clientId: string; // duplicated so rules can validate without an extra read
  status: ApplicationStatus;
  message: string;
  // Quick one-line summary of the bid. In the bid-marketplace flow this is
  // derived server-side from the quote total ({ type: "fixed", amount: total })
  // so existing list/notification rendering keeps working unchanged.
  proposedPrice: ProposedPrice;
  // Full itemized quote (bid-marketplace flow). Null on legacy applications
  // that only ever carried the one-line proposedPrice, and on site-visit
  // applications (kind === "site_visit"), which carry siteVisitFee instead.
  quote?: ApplicationQuote | null;
  // "full" = an itemized-quote bid (default; absent ⇒ "full" for back-compat).
  // "site_visit" = the tradesperson asks for a paid/free visit BEFORE quoting;
  // `quote` is null and `siteVisitFee` carries the single line. The client
  // accepts it one-tap (acceptApplication), the job is created in "requested",
  // and the agreed fee seeds jobs/{jobId}/siteVisit/current.
  kind?: "full" | "site_visit";
  siteVisitFee?: SiteVisitFee | null; // present only when kind === "site_visit"
  proposedStartDate: Timestamp | null;
  // Set by declineApplication when the client dismisses this applicant with a
  // reason. Surfaced to the tradie so they know what to change before re-applying.
  declinedReason?: string | null;
  declinedAt?: Timestamp | null;
  // Set by reviseApplication each time the tradie resubmits a revised quote.
  // The client's applicant card shows a "Revised" badge off revisedAt.
  revisedAt?: Timestamp | null;
  revisionCount?: number;
  // Denormalized metadata for the pre-acceptance Q&A thread (the messages
  // subcollection below). Maintained by the application-thread callables (admin
  // SDK) so clients never write the application doc directly. Both parties
  // subscribe to this doc already, so the unread badge + preview ride along
  // with no extra read. Optional — legacy applications predate the thread.
  threadLastMessageAt?: Timestamp | null;
  threadLastMessagePreview?: string;
  threadUnreadCounts?: Record<string, number>; // { [clientId]: n, [tradieId]: n }
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// jobPosts/{postId}/applications/{tradieId}/messages/{msgId}
// Pre-acceptance Q&A thread between the post-owning client and one applicant —
// deliberately NOT the job chat (chats/ is jobId-scoped and only created at
// acceptance). Application-scoped, text-only, dies with the application. Mirrors
// MessageDoc minus photoUrl. Writes are callable-only (sendApplicationMessage).
// ---------------------------------------------------------------------------
export type ApplicationMessageType = "text" | "system";

export interface ApplicationMessageDoc {
  senderId: string; // uid of client or tradie; "system" for revise/decline lines
  text: string;
  createdAt: Timestamp;
  type: ApplicationMessageType;
  // Denormalized at write-time — the parties can't read each other's user docs,
  // so the recipient renders the avatar + name off these. Null on system lines.
  senderName: string | null;
  senderPhotoURL: string | null;
}

// ---------------------------------------------------------------------------
// chats/{chatId}
// ---------------------------------------------------------------------------
export interface ChatDoc {
  jobId: string;
  clientId: string;
  tradespersonId: string;
  lastMessageAt: Timestamp | null;
  lastMessagePreview: string;
  unreadCounts: Record<string, number>;
}

export type MessageType = "text" | "photo" | "system";

export interface MessageDoc {
  senderId: string;
  text: string;
  photoUrl: string | null;
  createdAt: Timestamp;
  type: MessageType;
  // Denormalized at write-time so the recipient can render the sender's
  // name + avatar without a cross-account user-doc read (users/{uid} is
  // owner+admin only). System messages set senderId="system" and leave
  // these as null — the UI renders them centered with no avatar.
  senderName: string | null;
  senderPhotoURL: string | null;
}

// ---------------------------------------------------------------------------
// reviews/{reviewId} (public, client -> tradesperson)
// AirBnB-style mutual-blind: a review is invisible to its subject (the
// tradesperson) until BOTH parties have submitted OR the 14-day window
// elapses. `revealedAt` is the gate — null = still hidden, Timestamp =
// went live (rules + queries filter on it). The author always sees their
// own review regardless. Pre-cutover reviews may have no field; rules
// treat that as null (hidden to counterparty) — backfill before launch
// if any pre-cutover reviews must remain public.
// ---------------------------------------------------------------------------
export interface ReviewDoc {
  jobId: string;
  clientId: string;
  // Denormalized at write time so the public tradesperson profile can
  // render the reviewer's avatar + name without needing read access to
  // /users/{clientId} (which is owner+admin only). Resolved from the
  // signed-in client's auth profile when createReview runs. Optional
  // on the type because reviews written before this denormalization
  // landed don't carry them — UI falls back to a generic "Client" +
  // initial in that case.
  clientName?: string;
  clientPhotoURL?: string | null;
  tradespersonId: string;
  rating: number; // 1-5
  dimensions: {
    quality: number;
    punctuality: number;
    communication: number;
    value: number;
  };
  text: string;
  createdAt: Timestamp;
  status: "active" | "flagged" | "hidden";
  // Server-stamped by revealPair (lib/reviewPair.ts) when the counterparty
  // also submits OR the scheduled nudge force-reveals after the deadline.
  // Aggregation onto the tradie's ratingAvg only runs at reveal time.
  revealedAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// clientReviews/{reviewId} (private, tradie -> client; reveal-gated to client)
// Mirror of ReviewDoc on the private side. Reads:
//   - author (tradesperson) always
//   - subject (client) only after revealedAt is set
//   - admin always
//   - other tradies (future "have you worked with this client" lookup) —
//     gated on revealedAt + status (same as the public side).
// ---------------------------------------------------------------------------
export interface ClientReviewDoc {
  jobId: string;
  clientId: string;
  tradespersonId: string;
  rating: number;
  text: string;
  categoryScores: {
    punctuality: number;
    communication: number;
    clarity: number;
    payment: number;
  };
  createdAt: Timestamp;
  revealedAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// reviewPairs/{jobId}
// One doc per completed job — doc id = jobId (deterministic, same pattern
// as invoices). Created by markJobPaid / clientMarkPaid when the invoice
// flips to paid. Tracks who has submitted, when the 14-day window closes,
// when both reviews went live, and the nudge cadence.
//
// `locked` flips true once the deadline passes (scheduled nudge force-
// reveals whatever's been submitted and stops accepting new reviews).
// Without `locked`, a late client could still leave a review after seeing
// the tradesperson's already-revealed score — defeating the blind reveal.
// ---------------------------------------------------------------------------
export interface ReviewPairDoc {
  jobId: string;
  clientId: string;
  tradespersonId: string;
  invoicePaidAt: Timestamp;
  // invoicePaidAt + 14 days. Stored explicitly so the scheduled nudge can
  // do a `where("deadlineAt", "<=", now)` sweep without re-computing.
  deadlineAt: Timestamp;
  clientSubmittedAt: Timestamp | null;
  tradieSubmittedAt: Timestamp | null;
  // Pointers back to the underlying review docs so revealPair can flip
  // both revealedAt fields in one transaction.
  clientReviewId: string | null; // ref into reviews/{id}
  tradieReviewId: string | null; // ref into clientReviews/{id}
  revealedAt: Timestamp | null;
  // Daily-nudge bookkeeping. lastNudgedAt prevents the scheduled function
  // from sending a second reminder in the same UTC day if its window
  // overlaps; nudgeCount caps the run-rate (sanity ceiling on bug-spiral).
  lastNudgedAt: Timestamp | null;
  nudgeCount: number;
  // True once the deadline elapsed and the pair was force-revealed. No
  // more submissions accepted past this point (enforced by the create
  // rule on reviews/clientReviews which reads the pair doc).
  locked: boolean;
}

// ---------------------------------------------------------------------------
// bookings/{bookingId}
// ---------------------------------------------------------------------------
export interface BookingDoc {
  tradespersonId: string;
  start: Timestamp;
  end: Timestamp;
  type: "blocked" | "booked";
  jobId: string | null;
}

// ---------------------------------------------------------------------------
// invoices/{invoiceId}
// `processing | refunded | partially_refunded | disputed` were added with
// the Stripe Connect cutover. Pre-cutover invoices only carry the original
// states; new invoices walk: draft → sent → (processing) → paid →
// (refunded | partially_refunded | disputed). `void` is reachable from any
// pre-paid state via the future void-and-reissue callable.
// ---------------------------------------------------------------------------
export type InvoiceStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "processing"
  | "paid"
  | "overdue"
  | "refunded"
  | "partially_refunded"
  | "disputed"
  | "void";

// Classification of a line item — drives how the editor row collects input
// and how the rendered invoice/quote labels it. Optional/legacy lines that
// predate this field render with no badge and behave like the historical
// quantity × unitPrice shape (which is exactly what every kind reduces to
// when totaled).
//
//   hourly:    quantity = hours, unitPrice = hourly rate (cents/hr).
//              Total line = hours × rate. Auto-pulled time entries also
//              carry this kind.
//   labour:    flat-fee labour. quantity = 1, unitPrice = total.
//   materials: parts / receipts / supplies. quantity = 1, unitPrice = total.
//              Auto-pulled expense rows carry this kind.
export type LineItemKind = "hourly" | "labour" | "materials";

export interface LineItem {
  // Stable id for lines pulled in from a time entry or expense, so the
  // pull-billables flow can avoid double-pulling the same source row.
  // Manually-typed line items leave it undefined.
  id?: string;
  kind?: LineItemKind;
  description: string;
  quantity: number;
  unitPrice: number; // cents
  taxRate: number; // 0-1
}

// One refund event on a paid invoice. Appended to InvoicePaymentState.refunds
// when Stripe delivers a `charge.refunded` webhook; refundedAmount on the
// parent is the running total. `reason` is the Stripe-provided string
// ("requested_by_customer" / "duplicate" / "fraudulent") or a freeform
// admin note when refunded through the admin dashboard.
export interface InvoiceRefund {
  refundId: string;
  amount: number; // cents
  reason: string | null;
  createdAt: Timestamp;
}

// All Stripe-side state for a paid (or in-flight) invoice. Server-managed
// only: the `payment` field is locked against owner writes by /invoices
// rules. Created by `createInvoicePaymentIntent` / `sendInvoice`, mutated
// by the Stripe webhook dispatcher. `applicationFeeBps` is the snapshot of
// the platform fee BPS at send-time so historical invoices stay auditable
// even if the platform fee changes later. `lastWebhookEventId` lets the
// dispatcher short-circuit duplicate events at the per-invoice level on
// top of the global webhookEvents sentinel.
export interface InvoicePaymentState {
  paymentIntentId: string | null;
  clientSecret: string | null;
  chargeId: string | null;
  applicationFeeAmount: number | null; // cents
  applicationFeeBps: number | null;
  transferId: string | null;
  transferDestination: string | null;
  refundedAmount: number; // cents, running total; 0 if no refunds
  refunds: InvoiceRefund[];
  disputeId: string | null;
  disputeStatus: string | null;
  lastWebhookEventId: string | null;
}

// Optional whole-invoice discount applied to the subtotal before tax. Stored
// as a structured value (not a negative line item) so PDFs + the invoice view
// can render it on its own row and the math stays unambiguous when mixed tax
// rates are in play. Null when no discount is applied.
export interface InvoiceDiscount {
  type: "percent" | "fixed";
  // For "percent": 0-100 (UI clamps before write). For "fixed": cents.
  value: number;
  // Optional human label rendered next to the discount row (e.g.
  // "Repeat customer", "Veteran"). Null/empty hides the label.
  label: string | null;
}

// Credit applied to a final invoice for an upfront fee already collected on
// the underlying job. Mirrors the InvoiceDiscount shape (structured, not a
// negative line item) so totals math stays unambiguous and the PDF can render
// it on its own conditional row between tax and total. Written by
// onJobCompleted from the job's UpfrontFeeState; the invoice editor renders
// it read-only and recomputeTotals subtracts it from the final total
// (clamped to 0). Null when the job had no upfront fee.
export interface InvoiceUpfrontFeeCredit {
  amountCents: number;
  sourceQuoteId: string;
  paidAt: Timestamp;
}

export interface InvoiceDoc {
  tradespersonId: string;
  clientId: string;
  jobId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  lineItems: LineItem[];
  subtotal: number; // pre-discount sum of (quantity × unitPrice) across lines
  discount: InvoiceDiscount | null;
  discountAmount: number; // cents subtracted from subtotal; always 0 when discount is null
  taxTotal: number; // tax computed on the post-discount base, proportionally per line
  total: number; // subtotal − discountAmount + taxTotal
  currency: string;
  issuedAt: Timestamp | null;
  dueAt: Timestamp | null;
  sentAt: Timestamp | null;
  viewedAt: Timestamp | null;
  paidAt: Timestamp | null;
  pdfUrl: string | null;
  paymentInstructions: string;
  // `paymentMethod` is kept for legacy docs but is being phased out — the
  // Connect cutover makes "stripe" the only valid value. Removed from new
  // docs in the Phase B sendInvoice rewrite; readers should fall back to
  // `payment != null ? "stripe" : "manual"`.
  paymentMethod: "manual" | "stripe";
  recurring: { enabled: boolean; frequency: string; nextRunAt: Timestamp | null } | null;
  // Stripe-side state. Null on legacy invoices created before the Connect
  // cutover (they continue to support manual "mark paid"). Always set on
  // invoices created after the cutover. Server-managed.
  payment?: InvoicePaymentState | null;
  // Credit for an upfront fee collected at quote-accept time, snapshotted by
  // onJobCompleted from the job's UpfrontFeeState. Read-only in the editor;
  // subtracted from the final total after tax (clamped to 0). Null on
  // invoices for jobs that had no upfront fee.
  upfrontFeeCredit?: InvoiceUpfrontFeeCredit | null;
}

// ---------------------------------------------------------------------------
// disputes/{disputeId}
// Doc id == Stripe `dp_…` dispute id. Created by the `charge.dispute.created`
// webhook, updated by `charge.dispute.closed`. Mirrored locally (rather than
// hitting the Stripe API every time the admin queue renders) so the queue
// is a single Firestore query and parties can subscribe in real time.
// `evidenceDueBy` is sourced from Stripe's `evidence_details.due_by` so the
// admin queue can sort by urgency. Evidence submission itself happens in
// the Stripe Dashboard — Blue Seal's role is awareness + coordination.
// ---------------------------------------------------------------------------
export interface DisputeDoc {
  invoiceId: string;
  jobId: string | null;
  tradespersonId: string;
  clientId: string;
  chargeId: string;
  paymentIntentId: string;
  amount: number; // cents
  currency: string;
  // Raw Stripe values — we surface humanized versions in the UI but keep the
  // raw codes here so a UI change doesn't lose information.
  reason: string;
  status: string;
  // null while the dispute is still open; one of `won` / `lost` /
  // `warning_closed` when `charge.dispute.closed` fires.
  outcome: string | null;
  evidenceDueBy: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// quotes/{quoteId}
// Tradesperson-authored estimate sent to the client *before* work starts.
// Shape mirrors InvoiceDoc (same LineItem / InvoiceDiscount types, same
// totals math via recomputeTotals) so the editor + sheet UIs stay
// near-identical to their invoice counterparts. Deterministic id = jobId
// keeps the create idempotent.
//
// status timeline:
//   draft   — tradesperson is building, never shown to client
//   sent    — client now sees it; awaiting their decision
//   viewed  — client opened the job page after sent (soft signal)
//   accepted — client clicked Accept; job flips straight to "in_progress"
//   declined — client clicked Discuss/Decline; job stays "quoted" so the
//              tradesperson can revise and re-send (status flips back to
//              "sent" on next submitQuote call)
//   expired  — validUntil passed without a decision; scheduled function
//              (future) sets this and re-prompts the tradesperson
//   withdrawn — admin-only; reserved for support intervention
// ---------------------------------------------------------------------------
export type QuoteStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "accepted"
  | "declined"
  | "expired"
  | "withdrawn";

// Tradesperson-required upfront fee on a quote. Optional. When the client
// accepts a quote with this set, the job lands in "awaiting_upfront_payment"
// (not "in_progress") until the fee is collected. The amount in cents is
// always snapshotted server-side at submitQuote time — for `percent` we keep
// the bps for display ("25% upfront") AND the dollar value so a later
// line-item edit doesn't drift the agreed-upon fee.
//
// Bps cap is 5000 (50%) — see submitQuote validation. Fixed amounts are
// clamped to the pre-tax subtotal.
export type QuoteUpfrontFee =
  | { type: "fixed"; amountCents: number }
  | { type: "percent"; bps: number; amountCents: number };

export interface QuoteDoc {
  tradespersonId: string;
  clientId: string;
  jobId: string;
  quoteNumber: string;
  status: QuoteStatus;
  lineItems: LineItem[];
  subtotal: number;
  discount: InvoiceDiscount | null;
  discountAmount: number;
  taxTotal: number;
  total: number;
  currency: string;
  // Optional upfront fee required before work begins. See QuoteUpfrontFee.
  upfrontFee?: QuoteUpfrontFee | null;
  // Optional estimate hint shown alongside the totals — useful for hourly
  // ranges ("about 4-6 hours"). Free-form so tradies can write whatever
  // qualifier fits.
  estimatedHours: number | null;
  // Projected start date + expected duration shown to the client with the
  // quote. proposedStartDate is a calendar date stored at UTC midnight (format
  // it in UTC). estimatedDuration is free text ("2–3 days"). Optional — quotes
  // issued before these fields landed leave them undefined.
  proposedStartDate?: Timestamp | null;
  estimatedDuration?: string;
  // Quote expiry. Defaults to issuedAt + 14 days when the sheet submits.
  // The client banner shows "valid until {date}"; a (future) scheduled
  // function flips expired status past this date.
  validUntil: Timestamp | null;
  // Scope/exclusions/assumptions — free text shown verbatim on the quote.
  terms: string;
  // Short cover note rendered above the quote and surfaced in the chat
  // system-message preview when the quote is sent.
  noteToClient: string;
  // Optional rejection reason from clientDeclineQuote — preserved across
  // resends so the tradesperson can see "they declined with: X" while
  // revising.
  declinedReason: string | null;
  issuedAt: Timestamp | null;
  sentAt: Timestamp | null;
  viewedAt: Timestamp | null;
  acceptedAt: Timestamp | null;
  declinedAt: Timestamp | null;
  pdfUrl: string | null;
  // Storage path of the client's finger-drawn acceptance signature, written
  // server-side at accept time (clientAcceptQuote / acceptApplicationQuote).
  // Lives at jobs/{jobId}/signatures/quote-acceptance.png — server-write-only,
  // readable by both parties + admin. null/undefined only for quotes accepted
  // before this feature shipped. The signed instant IS acceptedAt (the
  // signature is the acceptance), so no separate timestamp is stored.
  clientSignatureStoragePath?: string | null;
}

// ---------------------------------------------------------------------------
// aiUsage/{usageId}
// jobId is nullable now that the assistant chatbot ("chat" tool) can be
// invoked from non-job pages — the older diagnose/quote/summary tools
// always carry a jobId.
// ---------------------------------------------------------------------------
export interface AiUsageDoc {
  userId: string;
  jobId: string | null;
  tool: "diagnose" | "quote" | "summary" | "chat" | "suggestReplies" | "updateJobLog";
  tokensIn: number;
  tokensOut: number;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// assistantConversations/{conversationId}
// Per-user AI-assistant threads. One thread per (userId, jobId) when the
// tradesperson is inside a job; one "general" thread per user for advice
// not tied to a specific job; one "admin" thread per admin for cross-page
// admin help (current-page context is injected per-turn into the prompt,
// not into the thread scope).
//
// Writes are server-only via the aiChat callable — both user and assistant
// turns persist together so the conversation history is always coherent.
// Clients read directly for live updates.
// ---------------------------------------------------------------------------
export type AssistantScope = "job" | "general" | "admin";

export interface AssistantConversationDoc {
  userId: string;
  scope: AssistantScope;
  jobId: string | null; // present iff scope === "job"
  title: string; // auto-derived ("General", job title, "Admin assistant")
  lastMessageAt: Timestamp | null;
  lastMessagePreview: string;
  messageCount: number;
  createdAt: Timestamp;
}

export type AssistantMessageRole = "user" | "assistant";

// What context the assistant turn was generated against. Persisted on the
// user turn so we can audit / debug / replay later (and so the UI can show
// "answered using N messages of job chat as context" if we want to surface
// that). Null on assistant turns.
export interface AssistantContextSnapshot {
  pageRoute: string | null;
  jobId: string | null;
  chatMessagesIncluded: number;
  // "user"      → typed in the composer, render normally
  // "quick-prompt" → fired by a Diagnose/Quote/Summary chip; hidden from
  //                  the thread UI but kept in history for follow-ups
  source?: "user" | "quick-prompt";
}

export interface AssistantMessageDoc {
  role: AssistantMessageRole;
  content: string;
  createdAt: Timestamp;
  tokensIn: number | null; // only set on assistant turns
  tokensOut: number | null;
  contextSnapshot: AssistantContextSnapshot | null;
}

// ---------------------------------------------------------------------------
// payouts/{stripePayoutId}
// Denormalised ledger of Stripe Connect payouts to tradespeople. Doc id is
// the Stripe `po_…` id so writes from `payout.created|paid|failed` webhook
// events are naturally idempotent. The tradie's "Payouts" view subscribes
// here (filtered by `tradespersonId`) instead of round-tripping to Stripe
// on every render.
//
// `invoiceIds[]` is best-effort: the dispatcher resolves it via the
// balance-transactions linked to the payout. Empty on payouts where the
// resolution failed or hadn't run yet — those still render with the gross
// amount, just without a line-item breakdown.
// ---------------------------------------------------------------------------
export type PayoutStatus =
  | "pending"
  | "in_transit"
  | "paid"
  | "failed"
  | "canceled";

export interface PayoutDoc {
  tradespersonId: string;
  stripeAccountId: string;
  stripePayoutId: string;
  amount: number; // net cents
  currency: string;
  arrivalDate: Timestamp;
  status: PayoutStatus;
  failureCode: string | null;
  failureMessage: string | null;
  invoiceIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// webhookEvents/{stripeEventId}
// Idempotency sentinel for the Stripe webhook dispatcher. Doc id is the
// Stripe event id (`evt_…`). The dispatcher does `create()` first (fails if
// already exists), then performs side-effects, then flips status to
// `processed`. Stripe retries deliver the same event id, so the second
// attempt sees the existing doc and exits without re-running side-effects.
// `status: "failed"` flags an event for ops — manual replay = delete the
// sentinel and let Stripe redeliver, or trigger from the Stripe dashboard.
// ---------------------------------------------------------------------------
export type WebhookEventStatus = "processing" | "processed" | "failed";

export interface WebhookEventDoc {
  type: string;
  receivedAt: Timestamp;
  processedAt: Timestamp | null;
  status: WebhookEventStatus;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// auditLog/{entryId}
// ---------------------------------------------------------------------------
export interface AuditLogDoc {
  actorUid: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// siteContent/{docId} — admin-editable site copy. World-readable, admin-only
// write. Today this holds homepage testimonials; future content blocks
// (banner copy, FAQ entries, etc.) get added as new fields on the same
// doc, or as new docs in this collection (one per page).
// ---------------------------------------------------------------------------
export interface Testimonial {
  quote: string;
  name: string;
  role: string;
}

export interface HomeContentDoc {
  testimonials: Testimonial[];
  updatedAt: Timestamp | null;
  updatedBy: string | null; // admin uid who last saved
}

// ---------------------------------------------------------------------------
// rebatePrograms/{slug} — curated government / utility rebate & grant programs.
//
// Reference data surfaced (read-only) to clients in the post-a-job flow when
// their trade is energy-relevant. Admin-managed (src/views/admin/
// AdminRebateProgramsView.vue); a code seed in src/data/rebatePrograms.ts is
// the launch fallback when the collection is empty. We NEVER assert a client is
// eligible — programs surface as "may apply", show their own eligibility
// conditions + a verified date, and link out to the official source to confirm
// and apply. Closed/paused programs keep their row (with status) for the audit
// trail but never surface in the client panel.
// ---------------------------------------------------------------------------

/** Which body administers a rebate program. */
export type RebateLevel = "federal" | "provincial" | "municipal" | "utility";

/** Lifecycle of a program. Only `active` programs surface to clients. */
export type RebateStatus = "active" | "closed" | "paused";

export interface RebateProgramDoc {
  slug: string; // stable kebab-case id; also the Firestore doc id
  name: string;
  provider: string; // administering body, e.g. "Natural Resources Canada"
  level: RebateLevel;
  national: boolean; // true = Canada-wide (provinces ignored when matching)
  provinces: string[]; // CA province codes (ON, BC, …) when not national
  trades: string[]; // trade keys it's relevant to (see src/data/trades.ts)
  summary: string; // what it offers, plain text
  amountNote: string; // qualitative amount, as the official source states it
  eligibilityNote: string; // key conditions (Markdown) — criteria, not a promise
  officialUrl: string; // REQUIRED https official source / application link
  status: RebateStatus;
  lastVerifiedAt: Timestamp; // when an admin last confirmed it against the source
  createdAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy: string; // admin uid (or "seed" for the code-seeded fallback)
}

// ---------------------------------------------------------------------------
// Help Center / FAQ content types.
//
// The content itself is hardcoded in src/data/help.ts (no CMS, no Firestore
// doc) — editing it is a deliberate code change. See CLAUDE.md: every major
// feature should be checked against the Help Center / FAQ. These types are
// shared by the data module, the search index, and the Help views.
// ---------------------------------------------------------------------------

/** Who an article/FAQ is most relevant to. "all" shows it to everyone. */
export type HelpAudience = "all" | "client" | "tradesperson";

export interface HelpCategory {
  id: string; // stable slug, referenced by article.categoryId
  title: string;
  description: string;
  icon: string; // PrimeIcons class, e.g. "pi pi-bolt"
}

export interface HelpArticle {
  slug: string; // unique URL id (/help/:slug)
  categoryId: string;
  title: string;
  excerpt: string; // one-line summary for cards + search snippets
  body: string; // Markdown (rendered with `marked`)
  keywords: string[]; // extra search terms not necessarily in the body
  audience: HelpAudience;
  popular?: boolean; // surfaced on the Help Center landing
}

export interface FaqItem {
  question: string;
  answer: string; // Markdown
  categoryId: string;
  audience: HelpAudience;
}

// ---------------------------------------------------------------------------
// supportTickets/{ticketId} — messages from the Help Center contact form.
// A signed-in user creates one (status starts "open", fields validated by
// rules); admins read + triage them from /admin/support and change the
// status. Signed-out visitors fall back to the email (mailto) flow instead,
// so this collection never takes unauthenticated writes. No Cloud Function —
// it's a direct client create under tight rules.
// ---------------------------------------------------------------------------
export type SupportTicketStatus = "open" | "in_progress" | "resolved" | "closed";

export interface SupportTicketDoc {
  userId: string; // uid of the signed-in submitter
  name: string;
  email: string; // reply-to (prefilled from the account, editable)
  topic: string; // one of SUPPORT_TOPICS (src/data/support.ts)
  message: string;
  status: SupportTicketStatus;
  handledBy: string | null; // admin uid who last changed the status
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// notifications/{notifId}
// In-app inbox per user. Writes are Cloud-Function-only (rules block client
// create + delete); the recipient can only flip `read` (and timestamp it).
// ---------------------------------------------------------------------------
export type NotificationType =
  | "message_received"
  | "job_requested"
  | "job_cancelled"
  | "new_application"
  | "application_accepted"
  | "application_rejected"
  | "application_returned"
  // Pre-acceptance applicant Q&A. `application_message` fires to the other party
  // when a message (or a revised-quote system line) lands in an application
  // thread. `application_declined` fires to the tradie when the client dismisses
  // their quote with a reason. Both link to /jobs/posted/{postId}.
  | "application_message"
  | "application_declined"
  | "vetting_approved"
  | "vetting_rejected"
  | "vetting_info_requested"
  | "cert_approved"
  | "id_approved"
  | "insurance_approved"
  | "wsib_approved"
  | "invoice_sent"
  | "invoice_paid"
  | "invoice_payment_failed"
  | "invoice_refunded"
  | "dispute_opened"
  | "review_received"
  // Mutual-review loop. `review_requested` fires when the invoice flips
  // to paid (both parties asked to leave a review). `review_reminder`
  // fires from the daily scheduled nudge at days 3/7/13 of the 14-day
  // window. `review_revealed` fires when the counterparty's review
  // becomes visible (either because both submitted or the deadline
  // forced reveal). All three link to /jobs/{id}?review=1&tab=invoice so
  // the click lands on the modal directly.
  | "review_requested"
  | "review_reminder"
  | "review_revealed"
  // "vouch_*" stay listed for back-compat with notifications written before
  // the Recommendations rename; new writes use the "recommendation_*"
  // variants. Both render with the same icon in NotificationsPanel.
  | "vouch_requested"
  | "vouch_accepted"
  | "recommendation_received"
  | "recommendation_accepted"
  | "new_job_posting"
  // Fires to the requesting client when a seeded prospect they asked for signs
  // up and their held lead converts into a real job. Links to /jobs/{id}.
  | "prospect_claimed"
  // Client cancel/postpone request loop on a committed job. `job_change_requested`
  // → tradesperson (client asked to cancel or hold). `job_change_accepted` /
  // `job_change_declined` → client (tradesperson's decision). `job_change_withdrawn`
  // → tradesperson (in-app only) when the client retracts a still-pending request.
  // `job_resumed` → the opposite party when a held job is taken off hold. All
  // link to /jobs/{id}.
  | "job_change_requested"
  | "job_change_accepted"
  | "job_change_declined"
  | "job_change_withdrawn"
  | "job_resumed"
  // Mid-job change-order loop (proposeExtra / respondExtra). `change_order_proposed`
  // → client (tradesperson proposes an out-of-scope charge to approve up front);
  // `change_order_approved` / `change_order_declined` → tradesperson (client's decision).
  | "change_order_proposed"
  | "change_order_approved"
  | "change_order_declined"
  // Pre-quote site-visit loop (proposeSiteVisit / respondSiteVisit). `site_visit_proposed`
  // → client (tradesperson wants to see the job before quoting, with an optional fee);
  // `site_visit_agreed` / `site_visit_declined` → tradesperson (client's one-tap decision).
  | "site_visit_proposed"
  | "site_visit_agreed"
  | "site_visit_declined"
  // Job-board referrals (sendJobReferral / submitApplication conversion hook).
  // `job_referred` → recipient tradesperson (a peer sent them an open post);
  // `referral_applied` → referrer (their recipient applied to the post). Both
  // link to /jobs/posted/{postId}.
  | "job_referred"
  | "referral_applied";

export interface NotificationDoc {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  readAt: Timestamp | null;
  createdAt: Timestamp;
  jobId: string | null;
  chatId: string | null;
  actorUid: string | null;
  // Denormalized snapshot of the actor's avatar + display name at the moment
  // the notification was written. Lets the in-app inbox render a profile
  // picture (e.g. the tradesperson who sent a message, the client who
  // accepted a quote) without an extra users/{actorUid} read per row.
  // Snapshot semantics: if the actor later changes their photo or name, old
  // notifications keep the values they had at write-time. Null when the
  // notification has no actor (system events like vetting decisions,
  // invoice-paid webhooks) or when the actor's user doc was unreadable at
  // write-time; legacy notifications created before this field existed are
  // also null and the UI falls back to the type icon.
  actorPhotoURL: string | null;
  actorDisplayName: string | null;
  // Which role the user should be viewing as for the link to make sense.
  // Set by the Cloud Function that creates the notification — every call
  // site already knows who it's targeting and why. The notifications-bell
  // click handler auto-switches activeRole to this before navigating so
  // multi-role accounts (e.g. someone who's both a client and a
  // tradesperson) land in the right view instead of seeing the page
  // through the wrong lens. Null on legacy docs created before the field
  // existed; the click handler treats null as "don't switch."
  recipientRole: Role | null;
}

// ---------------------------------------------------------------------------
// vouches/{vouchId}
// Peer endorsement: a tradesperson (fromUserId) vouches for another person
// they've worked with. Two flows feed the same collection:
//
//   pending_acceptance — vouchee already has a Blue Seal account; they get a
//     notification and must accept before the vouch becomes public.
//   pending_signup     — vouchee was invited by email; an invite email is
//     sent. When they sign up with that email, the linkPendingVouchesOnSignup
//     trigger flips the doc to accepted and stamps toUserId. Auto-acceptance:
//     the act of completing signup via the invited email counts as consent.
//
//   accepted — mutually visible on both profiles. Public-readable.
//   declined — vouchee said no. Read-only to parties + admin (not public).
//
// Display fields (fromDisplayName/fromPhotoURL/fromPrimaryTrade and the
// matching to* trio) are denormalised so the public profile can render the
// chip row without cross-account user-doc reads. They're snapshotted at
// acceptance/link time and not kept live in sync (small acceptable staleness
// vs the cost of a fanout trigger on every profile edit).
//
// Doc id is auto-generated. Uniqueness of (fromUserId, toUserId) and
// (fromUserId, toEmail) is enforced in the sendVouchRequest callable via a
// query, not by id — keeps the pending_signup → accepted path immutable-id
// safe.
// ---------------------------------------------------------------------------
export type VouchStatus =
  | "pending_acceptance"
  | "pending_signup"
  | "accepted"
  | "declined";

export interface VouchDoc {
  fromUserId: string;
  fromDisplayName: string;
  fromPhotoURL: string | null;
  fromPrimaryTrade: string | null;

  // Null while status === "pending_signup" — populated by the signup linker
  // trigger when the invited email completes signup.
  toUserId: string | null;
  // Captured at create time (voucher types the person's name). Overwritten
  // with the live displayName from the user doc on accept/link so the
  // profile chip matches the actual account name.
  toDisplayName: string;
  toPhotoURL: string | null;
  toPrimaryTrade: string | null;
  // Only set when the voucher invited by email (status pending_signup).
  // Cleared to null on link so we don't keep the email around once the
  // account exists.
  toEmail: string | null;

  status: VouchStatus;
  // Optional short note from the voucher ("worked together on the Riverside
  // project"). Rendered on the chip's tooltip on the profile.
  message: string;

  createdAt: Timestamp;
  // Stamped when status flips to accepted/declined OR when the signup
  // linker converts pending_signup → accepted.
  respondedAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// referrals/{postId}_{fromUserId}_{toUserId}
// Job-board referral: a tradesperson browsing the board (often with the
// "Any trade" filter) sends an open job post to another verified tradesperson
// whose trade matches it. Created only by the sendJobReferral callable; rules
// deny all client writes.
//
// The deterministic doc id makes dedupe a transactional exists-check (one
// referral per referrer → recipient → post), mirroring the
// applications/{tradieId} doc-id-as-constraint precedent. Unlike vouches the
// target identity never mutates (no email-invite path), so a composite id is
// safe.
//
// Post snapshot fields (postTitle/postTrade/postCity) are denormalised so
// referral rows render even after the post closes or expires, same tradeoff
// as the vouch display fields. No status enum — the only transition is
// "recipient applied", carried by appliedAt (stamped by submitApplication).
// ---------------------------------------------------------------------------
export interface ReferralDoc {
  postId: string;
  postTitle: string;
  postTrade: string;
  postCity: string;

  fromUserId: string;
  fromDisplayName: string;
  fromPhotoURL: string | null;
  fromPrimaryTrade: string | null;

  toUserId: string;
  toDisplayName: string;
  toPhotoURL: string | null;

  // Optional short note from the referrer ("this one's right up your alley").
  message: string;

  createdAt: Timestamp;
  // Conversion marker: set when the recipient applies to the post.
  appliedAt: Timestamp | null;
}
