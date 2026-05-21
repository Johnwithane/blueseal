import { z } from "zod";
import { TRADES } from "@/data/trades";

const tradeKeys = TRADES.map((t) => t.key) as [string, ...string[]];
const tradeKeyEnum = z.enum(tradeKeys);

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

export const tradieTradesSchema = z
  .object({
    primaryTrade: tradeKeyEnum,
    secondaryTrades: z.array(tradeKeyEnum).max(3, "Up to 3 secondary trades"),
    yearsExperience: z.record(z.number().int().min(0).max(80)),
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
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(4000),
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
  description: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(10_000),
  // Cents. $100,000 cap.
  unitPrice: z.number().int().nonnegative().max(10_000_000),
  taxRate: z.number().min(0).max(0.5),
});

// ---------------------------------------------------------------------------
// Job-board marketplace
// ---------------------------------------------------------------------------

// Canadian forward sortation area = first 3 chars of postal code, e.g. "V1Y".
const caFsaRegex = /^[A-Za-z]\d[A-Za-z]$/;

const addressPublicSchema = z.object({
  city: z.string().trim().min(2).max(100),
  region: z.string().trim().min(2).max(100),
  postalFsa: z
    .string()
    .trim()
    .toUpperCase()
    .regex(caFsaRegex, "Enter the first 3 chars of a Canadian postal code"),
});

const addressPrivateSchema = z.object({
  line1: z.string().trim().min(2).max(200),
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
  title: z.string().trim().min(5, "At least 5 characters").max(100),
  description: z.string().trim().min(20, "At least 20 characters").max(2000),
  photos: z.array(z.string().min(1).max(500)).min(1, "Add at least 1 photo").max(8),
  addressPublic: addressPublicSchema,
  addressPrivate: addressPrivateSchema,
  budget: budgetRangeSchema,
  urgency: z.enum(["flexible", "this_week", "urgent"]),
  preferredDateWindow: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date").nullable(),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date").nullable(),
  }),
});
export type CreateJobPostInput = z.infer<typeof createJobPostSchema>;

export const proposedPriceSchema = z.object({
  type: z.enum(["fixed", "hourly"]),
  // Cents. $5 floor, $100,000 cap.
  amount: z.number().int().min(500).max(10_000_000),
  notes: z.string().trim().max(500).optional(),
});

export const submitApplicationSchema = z.object({
  postId: z.string().min(1).max(128),
  message: z
    .string()
    .trim()
    .min(20, "Write at least a couple of sentences")
    .max(2000),
  proposedPrice: proposedPriceSchema,
  proposedStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
    .nullable()
    .optional(),
});
export type SubmitApplicationInput = z.infer<typeof submitApplicationSchema>;

export const acceptApplicationSchema = z.object({
  postId: z.string().min(1).max(128),
  applicationId: z.string().min(1).max(128),
});

export const returnToApplicantsSchema = z.object({
  postId: z.string().min(1).max(128),
});

export const cancelJobPostSchema = z.object({
  postId: z.string().min(1).max(128),
  reason: z.string().trim().max(500).optional(),
});

export const withdrawApplicationSchema = z.object({
  postId: z.string().min(1).max(128),
});
