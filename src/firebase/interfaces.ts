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
export type JobStatus =
  | "accepted"
  | "requested"
  | "quoted"
  | "scheduled"
  | "in_progress"
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
  cancelledAt: Timestamp | null;
  cancelledReason: string | null;
  chatId: string;
  privateNotes: string;
  // Set when this job was created via the job-board marketplace conversion.
  sourcePostId: string | null;
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
  description: string;
  quantity: number;
  unitPrice: number; // cents
  taxRate: number; // 0-1
}

export interface InvoiceDoc {
  tradespersonId: string;
  clientId: string;
  jobId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  lineItems: LineItem[];
  subtotal: number;
  taxTotal: number;
  total: number;
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
// ---------------------------------------------------------------------------
export interface AiUsageDoc {
  userId: string;
  jobId: string;
  tool: "diagnose" | "quote" | "summary";
  tokensIn: number;
  tokensOut: number;
  createdAt: Timestamp;
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
// notifications/{notifId}
// In-app inbox per user. Writes are Cloud-Function-only (rules block client
// create + delete); the recipient can only flip `read` (and timestamp it).
// ---------------------------------------------------------------------------
export type NotificationType =
  | "message_received"
  | "job_requested"
  | "application_accepted"
  | "application_rejected"
  | "vetting_approved"
  | "vetting_rejected"
  | "vetting_info_requested"
  | "cert_approved"
  | "cert_rejected"
  | "id_approved"
  | "id_rejected"
  | "invoice_sent"
  | "invoice_paid"
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
