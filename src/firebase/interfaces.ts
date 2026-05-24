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
  createdAt: Timestamp;
  lastActiveAt: Timestamp;
  emailVerified: boolean;
  hasActiveSubscription: boolean;
  stripeCustomerId: string | null;
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
  providesFreeQuotes: boolean;
  location: GeoPoint;
  geohash: string;
  serviceRadiusKm: number;
  primaryAddressText: string;
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
  paymentInstructions: string;
  submittedAt: Timestamp | null;
  approvedAt: Timestamp | null;
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
export type JobStatus =
  | "accepted"
  | "requested"
  | "quoted"
  | "scheduled"
  | "in_progress"
  | "awaiting_client_approval"
  | "awaiting_payment"
  | "complete"
  | "reviewed"
  | "cancelled";

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
  status: JobStatus;
  trade: string;
  title: string;
  description: string;
  // Empty {} on jobs created via the marketplace until the client completes the
  // trade-specific intake form (status transitions accepted → requested).
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
  cancelledAt: Timestamp | null;
  cancelledReason: string | null;
  // uid of the party who cancelled — used by onJobCancelled trigger to pick
  // the recipient of the notification (always the opposite party). Null
  // before cancellation, and on pre-existing jobs that were cancelled via
  // the tradesperson status dropdown before this field existed.
  cancelledBy: string | null;
  chatId: string;
  privateNotes: string;
  // Set when this job was created via the job-board marketplace conversion.
  sourcePostId: string | null;
  // Watermark for the auto-log feature (aiUpdateJobLog). Updated each time
  // the AI scans new client chat activity and either appends a note or
  // confirms there was nothing log-worthy. The auto-trigger on
  // JobDetailView short-circuits server-side when this is within a 1-hour
  // cooldown.
  privateNotesLastAutoUpdateAt: Timestamp | null;
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
export interface TimeEntryDoc {
  tradespersonId: string; // duplicated so rules don't need a job lookup
  clientId: string; // duplicated so rules don't need a job lookup
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  hourlyRateSnapshot: number; // cents
  notes: string;
  source: "clock" | "manual";
  invoicedAt: Timestamp | null;
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
  receiptStoragePath: string; // jobs/{jobId}/receipts/{uuid}.{ext}
  status: ExpenseStatus;
  aiParsed: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  invoicedAt: Timestamp | null;
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
  status: JobPostStatus;
  trade: string;
  title: string;
  description: string;
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
export type ApplicationStatus = "pending" | "selected" | "rejected" | "withdrawn";

export interface ProposedPrice {
  type: "fixed" | "hourly";
  amount: number; // cents
  notes?: string;
}

export interface ApplicationDoc {
  tradespersonId: string;
  postId: string; // duplicated so collectionGroup queries can filter by post
  clientId: string; // duplicated so rules can validate without an extra read
  status: ApplicationStatus;
  message: string;
  proposedPrice: ProposedPrice;
  proposedStartDate: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
// reviews/{reviewId} (public)
// ---------------------------------------------------------------------------
export interface ReviewDoc {
  jobId: string;
  clientId: string;
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
}

// ---------------------------------------------------------------------------
// clientReviews/{reviewId} (private, tradies only)
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
// ---------------------------------------------------------------------------
export type InvoiceStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "paid"
  | "overdue"
  | "void";

export interface LineItem {
  // Stable id for lines pulled in from a time entry or expense, so the
  // pull-billables flow can avoid double-pulling the same source row.
  // Manually-typed line items leave it undefined.
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number; // cents
  taxRate: number; // 0-1
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
  paymentMethod: "manual" | "stripe";
  recurring: { enabled: boolean; frequency: string; nextRunAt: Timestamp | null } | null;
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
  | "vetting_approved"
  | "vetting_rejected"
  | "vetting_info_requested"
  | "cert_approved"
  | "id_approved"
  | "insurance_approved"
  | "wsib_approved"
  | "invoice_sent"
  | "review_received";

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
}
