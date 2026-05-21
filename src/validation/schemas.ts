import { z } from "zod";

export const signUpSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  displayName: z.string().min(2, "Enter your name"),
  role: z.enum(["client", "tradesperson"]),
  termsAccepted: z.literal(true, {
    errorMap: () => ({
      message: "You must agree to the Terms of Service and Privacy Policy",
    }),
  }),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const profileBasicsSchema = z.object({
  displayName: z.string().min(2),
  phone: z.string().min(7).optional().or(z.literal("")),
  photoURL: z.string().url().nullable().optional(),
});

export const tradieTradesSchema = z.object({
  primaryTrade: z.string().min(1, "Pick your primary trade"),
  secondaryTrades: z.array(z.string()).max(3, "Up to 3 secondary trades"),
  yearsExperience: z.record(z.number().min(0).max(80)),
  bio: z.string().min(20, "Tell clients a bit about your work").max(2000),
});

export const tradiePricingSchema = z
  .object({
    pricingModel: z.enum(["hourly", "quote", "both"]),
    hourlyRate: z.number().int().nonnegative().nullable(),
    providesFreeQuotes: z.boolean(),
  })
  .refine(
    (v) => v.pricingModel === "quote" || (v.hourlyRate != null && v.hourlyRate > 0),
    { message: "Set an hourly rate or switch to quote-only", path: ["hourlyRate"] },
  );

export const tradieServiceAreaSchema = z.object({
  primaryAddressText: z.string().min(3),
  lat: z.number().refine((n) => n >= -90 && n <= 90),
  lng: z.number().refine((n) => n >= -180 && n <= 180),
  serviceRadiusKm: z.number().min(1).max(500),
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
  trade: z.string().min(1),
  issuingBody: z.string().min(2),
  certNumber: z.string().min(1),
  expiresAt: z.string().nullable(),
  fileUrl: z.string().url(),
});

export const idVerificationFormSchema = z.object({
  documentType: z.enum(["drivers_license", "passport", "provincial_id"]),
  fileUrl: z.string().url(),
});

export const jobRequestSchema = z.object({
  tradespersonId: z.string().min(1),
  trade: z.string().min(1),
  title: z.string().min(3).max(140),
  description: z.string().min(10).max(4000),
  urgency: z.enum(["flexible", "this_week", "urgent"]),
  address: z.object({
    line1: z.string().min(2),
    city: z.string().min(2),
    region: z.string().min(2),
    postalCode: z.string().min(3),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }),
  intakeFormData: z.record(z.unknown()),
  intakePhotos: z.array(z.string().url()).min(1).max(8),
});

export const reviewSchema = z.object({
  rating: z.number().min(1).max(5),
  text: z.string().max(2000),
  dimensions: z.object({
    quality: z.number().min(1).max(5),
    punctuality: z.number().min(1).max(5),
    communication: z.number().min(1).max(5),
    value: z.number().min(1).max(5),
  }),
});

export const clientReviewSchema = z.object({
  rating: z.number().min(1).max(5),
  text: z.string().max(2000),
  categoryScores: z.object({
    punctuality: z.number().min(1).max(5),
    communication: z.number().min(1).max(5),
    clarity: z.number().min(1).max(5),
    payment: z.number().min(1).max(5),
  }),
});

export const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().int().nonnegative(),
  taxRate: z.number().min(0).max(1),
});
