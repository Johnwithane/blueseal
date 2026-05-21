import type { GeoPoint, Timestamp } from "firebase/firestore";

export type Role = "client" | "tradesperson" | "admin";

export type WithId<T> = T & { id: string };

// ---------------------------------------------------------------------------
// users/{uid}
// ---------------------------------------------------------------------------
export interface UserDoc {
  role: Role;
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
export type JobStatus =
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
  intakeFormData: Record<string, unknown>;
  intakePhotos: string[];
  address: JobAddress;
  preferredDateWindow: { start: Timestamp | null; end: Timestamp | null };
  urgency: Urgency;
  scheduledStart: Timestamp | null;
  scheduledEnd: Timestamp | null;
  createdAt: Timestamp;
  completedAt: Timestamp | null;
  chatId: string;
  privateNotes: string;
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
