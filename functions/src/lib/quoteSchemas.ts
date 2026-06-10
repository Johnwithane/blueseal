import { z } from "zod";

// Shared zod schemas for quote line items / discount / upfront fee. Lifted
// from submitQuote.ts so submitApplication validates an applicant's quote with
// exactly the same bounds as the direct-request quote flow.

export const LineItemSchema = z.object({
  kind: z.enum(["hourly", "labour", "materials"]).optional(),
  description: z.string().min(1).max(200),
  quantity: z.number().min(0).max(10_000),
  unitPrice: z.number().int().min(0).max(100_000_000),
  taxRate: z.number().min(0).max(1),
});

export const DiscountSchema = z.object({
  type: z.enum(["percent", "fixed"]),
  value: z.number().min(0),
  label: z.string().max(60).nullable(),
});

// A single "site visit before quoting" fee line. feeCents 0 = free visit.
// Mirrors siteVisitFeeSchema in src/validation/schemas.ts (server bounds).
export const SiteVisitFeeSchema = z.object({
  description: z.string().trim().min(1).max(200),
  feeCents: z.number().int().min(0).max(100_000_000), // 0 allowed = free
  taxRate: z.number().min(0).max(1),
});

// Upfront fee input — discriminated union so the client can pass either shape
// unambiguously. amountCents is the dollar value at submit time; bps (basis
// points, 0–5000 = 0–50%) is only present for "percent". The cents are always
// re-derived server-side (see resolveUpfrontFee) so a malicious client can't
// underpay relative to the quote they're agreeing to.
export const UpfrontFeeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("fixed"),
    amountCents: z.number().int().min(1).max(100_000_000),
  }),
  z.object({
    // 50% cap — see Quote upfront fee plan. 1bps = 0.01%.
    type: z.literal("percent"),
    bps: z.number().int().min(1).max(5000),
  }),
]);
