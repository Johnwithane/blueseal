import { z } from "zod";
import { TRADES } from "@/data/trades";
import { SUPPORT_TOPICS } from "@/data/support";
import { SERVICES_MAX, SERVICE_NAME_MAX } from "@/utils/services";

const tradeKeys = TRADES.map((t) => t.key) as [string, ...string[]];
// Friendly fallback so an empty/invalid trade surfaces as "Please choose a
// trade" everywhere this enum is used, instead of leaking the raw Zod dump
// ("Invalid enum value. Expected 'plumber' | 'electrician' | …").
const tradeKeyEnum = z.enum(tradeKeys, {
  errorMap: () => ({ message: "Please choose a trade" }),
});

// Canadian postal format (e.g. "V8V 2P1"). Tolerates lowercase + hyphen, normalize before storing.
const caPostalRegex = /^[A-Za-z]\d[A-Za-z][\s-]?\d[A-Za-z]\d$/;
// Liberal phone format — country prefix optional, allow spaces / dashes / parens.
const phoneRegex = /^\+?[\d\s\-()]{10,20}$/;

const safeName = z
  .string()
  .trim()
  .min(2, "Enter your name")
  .max(80)
  .regex(/^[\p{L}\p{N}\s.'-]+$/u, "Use letters, numbers, spaces, ' . -");

export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  password: z.string().min(8, "At least 8 characters").max(128),
  displayName: safeName,
  role: z.enum(["client", "tradesperson"]),
  termsAccepted: z.literal(true, {
    errorMap: () => ({
      message: "You must agree to the Terms of Service and Privacy Policy",
    }),
  }),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(128),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const profileBasicsSchema = z.object({
  displayName: safeName,
  phone: z
    .string()
    .trim()
    .regex(phoneRegex, "Enter a valid phone number")
    .optional()
    .or(z.literal("")),
  photoURL: z.string().url().nullable().optional(),
});

// Free-text "services offered" list (e.g. "Boiler installation"). Bounds mirror
// src/utils/services.ts so the editor, this schema, and the normalizer agree.
export const servicesSchema = z
  .array(z.string().trim().min(1).max(SERVICE_NAME_MAX))
  .max(SERVICES_MAX, `Up to ${SERVICES_MAX} services`);

export const tradieTradesSchema = z
  .object({
    primaryTrade: tradeKeyEnum,
    secondaryTrades: z.array(tradeKeyEnum).max(3, "Up to 3 secondary trades"),
    yearsExperience: z.record(z.number().int().min(0).max(80)),
    services: servicesSchema.optional(),
    bio: z.string().trim().min(20, "Tell clients a bit about your work").max(2000),
  })
  .refine(
    (v) => {
      const all = new Set([v.primaryTrade, ...v.secondaryTrades]);
      return Object.keys(v.yearsExperience).every((k) => all.has(k));
    },
    { message: "yearsExperience keys must match selected trades", path: ["yearsExperience"] },
  );

export const tradiePricingSchema = z
  .object({
    pricingModel: z.enum(["hourly", "quote", "both"]),
    // Cents. Cap at $10,000/hr to catch unit-mistake typos early.
    hourlyRate: z.number().int().min(0).max(1_000_000).nullable(),
    // Optional separate travel/callout rate (cents). Null falls back to hourlyRate.
    travelRate: z.number().int().min(0).max(1_000_000).nullable(),
    providesFreeQuotes: z.boolean(),
  })
  .refine(
    (v) => v.pricingModel === "quote" || (v.hourlyRate != null && v.hourlyRate > 0),
    { message: "Set an hourly rate or switch to quote-only", path: ["hourlyRate"] },
  );

export const tradieServiceAreaSchema = z.object({
  primaryAddressText: z.string().trim().min(3).max(200),
  lat: z.number().refine((n) => n >= -90 && n <= 90),
  lng: z.number().refine((n) => n >= -180 && n <= 180),
  serviceRadiusKm: z.number().min(1).max(200),
});

export const availabilityBlockSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const weeklyAvailabilitySchema = z.object({
  mon: z.array(availabilityBlockSchema),
  tue: z.array(availabilityBlockSchema),
  wed: z.array(availabilityBlockSchema),
  thu: z.array(availabilityBlockSchema),
  fri: z.array(availabilityBlockSchema),
  sat: z.array(availabilityBlockSchema),
  sun: z.array(availabilityBlockSchema),
});

export const certificationFormSchema = z.object({
  trade: tradeKeyEnum,
  issuingBody: z.string().trim().min(2).max(200),
  certNumber: z.string().trim().min(1).max(100),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
    .nullable(),
  fileUrl: z.string().url().max(2000),
});

export const idVerificationFormSchema = z.object({
  documentType: z.enum(["drivers_license", "passport", "provincial_id"]),
  fileUrl: z.string().url().max(2000),
});

export const jobRequestSchema = z.object({
  tradespersonId: z.string().min(1).max(128),
  trade: tradeKeyEnum,
  title: z.string().trim().min(1, "Add a title").max(140),
  description: z.string().trim().min(1, "Add a description").max(4000),
  urgency: z.enum(["flexible", "this_week", "urgent"]),
  address: z.object({
    line1: z.string().trim().min(2).max(200),
    city: z.string().trim().min(2).max(100),
    region: z.string().trim().min(2).max(100),
    postalCode: z
      .string()
      .trim()
      .regex(caPostalRegex, "Enter a valid Canadian postal code"),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }),
  intakeFormData: z.record(z.unknown()),
  intakePhotos: z.array(z.string().url().max(2000)).min(1).max(8),
});

// Tradesperson-created job for an off-platform client (createInviteJob).
// Email is lowercased here so the invite's emailLower matches what the claim
// flow compares against; the callable re-validates server-side.
export const inviteJobSchema = z.object({
  trade: tradeKeyEnum,
  title: z.string().trim().min(3, "Give the job a short title").max(140),
  description: z.string().trim().min(10, "Add a short description of the work").max(4000),
  clientName: z.string().trim().min(1, "Your client's name").max(80),
  clientEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address")
    .max(200),
  urgency: z.enum(["flexible", "this_week", "urgent"]),
  address: z.object({
    line1: z.string().trim().min(2, "Enter the street address").max(200),
    city: z.string().trim().min(2, "Enter the city").max(100),
    region: z.string().trim().min(2, "Enter the province").max(100),
    postalCode: z
      .string()
      .trim()
      .regex(caPostalRegex, "Enter a valid Canadian postal code"),
  }),
  preferredStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(2000),
  dimensions: z.object({
    quality: z.number().int().min(1).max(5),
    punctuality: z.number().int().min(1).max(5),
    communication: z.number().int().min(1).max(5),
    value: z.number().int().min(1).max(5),
  }),
});

export const clientReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(2000),
  categoryScores: z.object({
    punctuality: z.number().int().min(1).max(5),
    communication: z.number().int().min(1).max(5),
    clarity: z.number().int().min(1).max(5),
    payment: z.number().int().min(1).max(5),
  }),
});

export const lineItemSchema = z.object({
  // Stable id when the row was pulled in from a time entry or expense,
  // so the pull-billables flow can detect re-pulls. Manual rows omit it.
  id: z.string().min(1).max(128).optional(),
  // Classification — drives editor input shape + render label. Optional
  // so legacy/free-form lines keep working.
  kind: z.enum(["hourly", "labour", "materials"]).optional(),
  description: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(10_000),
  // Cents. $100,000 cap.
  unitPrice: z.number().int().nonnegative().max(10_000_000),
  taxRate: z.number().min(0).max(0.5),
});

// Reusable scope-of-work blueprint saved from the quote composer
// (tradespeople/{uid}/quoteTemplates). Bounds mirror the Firestore rules.
export const quoteTemplateSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(60),
  lineItems: z.array(lineItemSchema).min(1, "Add at least one line item").max(50),
});

// ---------------------------------------------------------------------------
// Job-board marketplace
// ---------------------------------------------------------------------------

// Canadian forward sortation area = first 3 chars of postal code, e.g. "V1Y".
const caFsaRegex = /^[A-Za-z]\d[A-Za-z]$/;

const addressPublicSchema = z.object({
  city: z.string().trim().min(2, "Enter your city").max(100),
  region: z.string().trim().min(2, "Enter your province").max(100),
  postalFsa: z
    .string()
    .trim()
    .toUpperCase()
    .regex(caFsaRegex, "Enter the first 3 chars of a Canadian postal code"),
});

const addressPrivateSchema = z.object({
  line1: z.string().trim().min(2, "Enter your street address").max(200),
  fullPostal: z
    .string()
    .trim()
    .regex(caPostalRegex, "Enter a valid Canadian postal code"),
  lat: z.number().refine((n) => n >= -90 && n <= 90),
  lng: z.number().refine((n) => n >= -180 && n <= 180),
});

export const budgetRangeSchema = z
  .object({
    // Cents, $5 floor to catch unit-mistake typos.
    min: z.number().int().min(500).max(100_000_000),
    max: z.number().int().min(500).max(100_000_000),
    currency: z.literal("CAD"),
  })
  .refine((v) => v.max >= v.min, {
    message: "Max budget must be at least the min budget",
    path: ["max"],
  });

export const createJobPostSchema = z.object({
  trade: tradeKeyEnum,
  title: z.string().trim().min(1, "Add a title").max(100),
  description: z.string().trim().min(1, "Add a description").max(2000),
  photos: z.array(z.string().min(1).max(500)).min(1, "Add at least 1 photo").max(8),
  addressPublic: addressPublicSchema,
  addressPrivate: addressPrivateSchema,
  budget: budgetRangeSchema,
  urgency: z.enum(["flexible", "this_week", "urgent"]),
  preferredDateWindow: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date").nullable(),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date").nullable(),
  }),
  // Trade-specific questionnaire answers (keys come from the trade's intake
  // schema). Loose on the client — values are built from typed form inputs;
  // the createJobPost callable re-validates shape + bounds at the boundary.
  intakeFormData: z.record(z.unknown()).default({}),
});
export type CreateJobPostInput = z.infer<typeof createJobPostSchema>;

export const proposedPriceSchema = z.object({
  type: z.enum(["fixed", "hourly"]),
  // Cents. $5 floor, $100,000 cap.
  amount: z.number().int().min(500).max(10_000_000),
  notes: z.string().trim().max(500).optional(),
});

// Upfront-fee input for a quote. Discriminated union: a fixed dollar amount
// (cents) or a percentage in basis points (1bps = 0.01%, capped 0–5000 = 0–50%).
// The server always re-derives the cents from the pre-tax base.
export const quoteUpfrontFeeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixed"), amountCents: z.number().int().min(1).max(100_000_000) }),
  z.object({ type: z.literal("percent"), bps: z.number().int().min(1).max(5000) }),
]);

// A single fee line for a "site visit before quoting" agreement. feeCents >= 0
// ($0 = free visit), one tax rate. Used by both the direct-request proposeSiteVisit
// callable and a site-visit job-board application (in place of a full quote).
// Mirrors SiteVisitFeeSchema in functions/src/lib/quoteSchemas.ts.
export const siteVisitFeeSchema = z.object({
  description: z.string().trim().min(1, "Add a short label").max(200),
  feeCents: z.number().int().nonnegative().max(10_000_000), // 0 allowed = free
  taxRate: z.number().min(0).max(0.5).default(0),
});
export type SiteVisitFeeInput = z.infer<typeof siteVisitFeeSchema>;

// Itemized quote attached to a marketplace application. Mirrors the submitQuote
// callable input (functions/src/lib/quoteSchemas.ts) so client + server agree
// on bounds; the server recomputes every total and the upfront-fee cents.
export const applicationQuoteSchema = z.object({
  lineItems: z.array(lineItemSchema).min(1, "Add at least one line").max(40),
  discount: z
    .object({
      type: z.enum(["percent", "fixed"]),
      value: z.number().min(0),
      label: z.string().max(60).nullable(),
    })
    .nullable()
    .default(null),
  estimatedHours: z.number().min(0).max(10_000).nullable().default(null),
  validUntilDays: z.number().int().min(1).max(180).default(14),
  terms: z.string().max(2000).default(""),
  noteToClient: z.string().max(500).default(""),
  upfrontFee: quoteUpfrontFeeSchema.nullable().default(null),
  estimatedDuration: z.string().max(80).default(""),
});
export type ApplicationQuoteInput = z.infer<typeof applicationQuoteSchema>;

// Shared across both application kinds. The cover message is a suggestion,
// not a gate — an empty message must never block a quote (per Johnny,
// 2026-06-11; the UI nudges with a tip instead).
const applicationBaseFields = {
  postId: z.string().min(1).max(128),
  message: z.string().trim().max(2000).default(""),
  proposedStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
    .nullable()
    .optional(),
};

// An application is a full itemized quote (kind "full"), a "site visit before
// quoting" ask (kind "site_visit", carrying a single siteVisitFee instead of a
// quote), OR a "chat first" opener (kind "chat" — no quote yet; the message
// seeds the Q&A thread and the quote follows via reviseApplication). Wrapped
// in preprocess so legacy callers that omit `kind` resolve to "full" —
// discriminatedUnion needs the discriminator present to route.
export const submitApplicationSchema = z.preprocess(
  (val) =>
    val && typeof val === "object" && !("kind" in val) ? { ...val, kind: "full" } : val,
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("full"),
      ...applicationBaseFields,
      // Full itemized quote — the bid the client compares + accepts. The server
      // derives the one-line proposedPrice summary from this.
      quote: applicationQuoteSchema,
    }),
    z.object({
      kind: z.literal("site_visit"),
      ...applicationBaseFields,
      // Single visit fee ($0 = free). No full quote yet — the tradesperson quotes
      // after the visit.
      siteVisitFee: siteVisitFeeSchema,
    }),
    z.object({
      kind: z.literal("chat"),
      ...applicationBaseFields,
      // The opener IS the application — it has to say something.
      message: z.string().trim().min(1, "Write an opening message").max(2000),
    }),
  ]),
);
export type SubmitApplicationInput = z.infer<typeof submitApplicationSchema>;

// Direct-request flow: tradesperson proposes a site visit before quoting.
export const proposeSiteVisitSchema = z.object({
  jobId: z.string().min(1).max(128),
  fee: siteVisitFeeSchema,
  proposedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
    .nullable()
    .default(null),
  note: z.string().trim().max(500).default(""),
});
export type ProposeSiteVisitInput = z.infer<typeof proposeSiteVisitSchema>;

// Client agrees to / declines a proposed site visit (one tap, no signature).
export const respondSiteVisitSchema = z.object({
  jobId: z.string().min(1).max(128),
  accept: z.boolean(),
  declinedReason: z.string().trim().max(1000).default(""),
});
export type RespondSiteVisitInput = z.infer<typeof respondSiteVisitSchema>;

export const acceptApplicationSchema = z.object({
  postId: z.string().min(1).max(128),
  applicationId: z.string().min(1).max(128),
});

export const returnToApplicantsSchema = z.object({
  postId: z.string().min(1).max(128),
});

export const cancelJobPostSchema = z.object({
  postId: z.string().min(1).max(128),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const withdrawApplicationSchema = z.object({
  postId: z.string().min(1).max(128),
});

// Pre-acceptance applicant Q&A. The thread is keyed by (postId, applicationId)
// where applicationId == the tradesperson uid (the application doc id).
export const sendApplicationMessageSchema = z.object({
  postId: z.string().min(1).max(128),
  applicationId: z.string().min(1).max(128),
  text: z.string().trim().min(1, "Write a message").max(2000),
});
export type SendApplicationMessageInput = z.infer<typeof sendApplicationMessageSchema>;

// Client declines an applicant's quote with a reason — mirrors clientDeclineQuote
// on the direct-request side (same 1–1000 bounds).
export const declineApplicationSchema = z.object({
  postId: z.string().min(1).max(128),
  applicationId: z.string().min(1).max(128),
  reason: z.string().trim().min(1, "Give a brief reason").max(1000),
});
export type DeclineApplicationInput = z.infer<typeof declineApplicationSchema>;

// Tradesperson resubmits a revised quote on an existing pending application.
// Same quote shape as submitApplication; the message is an optional refreshed
// cover note (no min — they may only be tweaking the price).
export const reviseApplicationSchema = z.object({
  postId: z.string().min(1).max(128),
  quote: applicationQuoteSchema,
  message: z.string().trim().min(20, "Write at least a couple of sentences").max(2000).optional(),
  proposedStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
    .nullable()
    .optional(),
});
export type ReviseApplicationInput = z.infer<typeof reviseApplicationSchema>;

// ---------------------------------------------------------------------------
// AI assistant chatbot
// Input shape for the aiChat callable. The Cloud Function re-validates with
// its own copy of this schema to keep callable inputs locked in even if a
// future refactor diverges the client-side schema.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Vouches — peer endorsements between tradespeople. sendVouchRequest accepts
// EITHER an existing user by uid OR a new invitee by email — exactly one,
// not both. The refine() at the bottom enforces that XOR.
// ---------------------------------------------------------------------------
export const sendVouchRequestSchema = z
  .object({
    toUserId: z.string().min(1).max(128).optional(),
    toEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email")
      .max(200)
      .optional(),
    // Display name the voucher types in. For existing-user requests this is
    // a hint only — the server overwrites with the live displayName on
    // accept. For email invites it's what appears in the invite email and
    // as a placeholder until the invitee signs up.
    toDisplayName: z.string().trim().min(1).max(80),
    message: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) => (v.toUserId == null) !== (v.toEmail == null),
    {
      message: "Provide either toUserId or toEmail, not both",
      path: ["toUserId"],
    },
  );
export type SendVouchRequestInput = z.infer<typeof sendVouchRequestSchema>;

export const vouchIdSchema = z.object({
  vouchId: z.string().min(1).max(128),
});
export type VouchIdInput = z.infer<typeof vouchIdSchema>;

// ---------------------------------------------------------------------------
// Job-board referrals — a tradesperson sends an open post to another verified
// tradesperson whose trade matches. The sendJobReferral callable re-validates
// with its own copy of this schema.
// ---------------------------------------------------------------------------
export const sendJobReferralSchema = z.object({
  postId: z.string().min(1).max(128),
  toUserId: z.string().min(1).max(128),
  message: z.string().trim().max(300).optional(),
});
export type SendJobReferralInput = z.infer<typeof sendJobReferralSchema>;

export const aiChatInputSchema = z
  .object({
    // Omit to auto-resolve by (userId, scope, jobId) — backend creates one
    // if no matching conversation exists.
    conversationId: z.string().min(1).max(128).optional(),
    scope: z.enum(["job", "general", "admin"]),
    jobId: z.string().min(1).max(128).nullable().optional(),
    // Current route the user is on (e.g. "/dashboard/tradie"). Injected
    // into the per-turn system prompt so the assistant knows where the
    // user is. Cap modestly — the route is enough; we don't accept full
    // page state.
    pageRoute: z.string().max(200).nullable().optional(),
    message: z.string().trim().min(1).max(4000),
    // Quick-prompt actions (Diagnose/Quote/Summary chips) set this so the
    // user-side bubble is suppressed in the thread UI. The message still
    // persists so the model has context for follow-ups.
    hidden: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.scope !== "job" ||
      (typeof v.jobId === "string" && v.jobId.length > 0),
    { message: "scope=job requires a jobId", path: ["jobId"] },
  );
export type AiChatInput = z.infer<typeof aiChatInputSchema>;

// ---------------------------------------------------------------------------
// Help Center content (siteContent/help). Validated at the boundary before an
// admin write so the public Help Center never has to defend against malformed
// data. The audience enum gates who an article/FAQ is shown to.
// ---------------------------------------------------------------------------
const helpAudienceEnum = z.enum(["all", "client", "tradesperson"]);
const helpSlugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const helpCategorySchema = z.object({
  id: z.string().trim().regex(helpSlugRegex, "Use a lowercase slug (e.g. getting-started)").max(60),
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(240),
  icon: z.string().trim().min(2).max(60),
});

export const helpArticleSchema = z.object({
  slug: z.string().trim().regex(helpSlugRegex, "Use a lowercase slug (e.g. find-a-tradesperson)").max(80),
  categoryId: z.string().trim().min(1).max(60),
  title: z.string().trim().min(2).max(120),
  excerpt: z.string().trim().min(2).max(240),
  body: z.string().trim().min(2).max(20000),
  keywords: z.array(z.string().trim().min(1).max(40)).max(40),
  audience: helpAudienceEnum,
  popular: z.boolean().optional(),
});

export const helpFaqSchema = z.object({
  question: z.string().trim().min(2).max(200),
  answer: z.string().trim().min(2).max(2000),
  categoryId: z.string().trim().min(1).max(60),
  audience: helpAudienceEnum,
});

export const helpContentSchema = z
  .object({
    categories: z.array(helpCategorySchema).max(40),
    articles: z.array(helpArticleSchema).max(400),
    faqs: z.array(helpFaqSchema).max(400),
  })
  .superRefine((data, ctx) => {
    // Slugs must be unique (they're the article URL) and every article/FAQ
    // must point at a real category — a dangling categoryId would render an
    // orphaned, unreachable article.
    const catIds = new Set(data.categories.map((c) => c.id));
    const seenCat = new Set<string>();
    data.categories.forEach((c, i) => {
      if (seenCat.has(c.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate category id "${c.id}"`, path: ["categories", i, "id"] });
      }
      seenCat.add(c.id);
    });
    const seenSlug = new Set<string>();
    data.articles.forEach((a, i) => {
      if (seenSlug.has(a.slug)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate article slug "${a.slug}"`, path: ["articles", i, "slug"] });
      }
      seenSlug.add(a.slug);
      if (!catIds.has(a.categoryId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Article "${a.slug}" references unknown category "${a.categoryId}"`, path: ["articles", i, "categoryId"] });
      }
    });
    data.faqs.forEach((f, i) => {
      if (!catIds.has(f.categoryId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `FAQ #${i + 1} references unknown category "${f.categoryId}"`, path: ["faqs", i, "categoryId"] });
      }
    });
  });

// ---------------------------------------------------------------------------
// Support ticket (supportTickets/{id}) — the Help Center contact form input.
// Validated client-side before the create; the Firestore rules enforce the
// same shape server-side (defence in depth). Topic is constrained to the
// known list so the admin queue stays tidy.
// ---------------------------------------------------------------------------
const supportTopicEnum = z.enum(SUPPORT_TOPICS as unknown as [string, ...string[]]);

export const supportTicketSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  topic: supportTopicEnum,
  message: z.string().trim().min(5, "Add a short message").max(2000),
});
export type SupportTicketInput = z.infer<typeof supportTicketSchema>;

// ---------------------------------------------------------------------------
// Bug report (bugReports/{id}) — the in-app QA "Report a bug" form. Only the
// human-entered fields live here; the bugReports service stamps reporter /
// route / status / timestamps. Caps mirror the Firestore rules — but we
// TRUNCATE rather than reject, so a tester who pastes a paragraph into a field
// (or types the whole bug into the title box) still files cleanly instead of
// hitting a "something went wrong". The only hard requirement is a 3+ char
// title, and the Report-a-bug button derives one from any other content when
// the box is left blank — so a report goes through as long as there's content
// somewhere.
// ---------------------------------------------------------------------------
const trimCap = (max: number) =>
  z
    .string()
    .trim()
    .transform((s) => s.slice(0, max));

export const bugReportSchema = z.object({
  // min(3) runs on the full trimmed string (so a too-short title is still
  // caught), THEN we cap to 140 — an over-long title is trimmed, never rejected.
  title: z
    .string()
    .trim()
    .min(3, "Give the bug a short title (at least 3 characters).")
    .transform((s) => s.slice(0, 140)),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  stepsToReproduce: trimCap(4000).default(""),
  expected: trimCap(2000).default(""),
  actual: trimCap(2000).default(""),
  area: trimCap(60).default(""),
  screenshotPaths: z
    .array(z.string().transform((s) => s.slice(0, 400)))
    .default([])
    .transform((a) => a.slice(0, 5)),
});
export type BugReportInput = z.infer<typeof bugReportSchema>;
