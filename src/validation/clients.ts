// Validation for the Clients book (CRM — Blue Seal Pro). The add/edit form
// boundary; the CSV-import row schema (Phase B) lives alongside it later.
// Output is the normalized shape clientsService writes: optional contact fields
// collapse empty strings to null, and a fully-blank address becomes null.
import { z } from "zod";

// Liberal phone format — country prefix optional; spaces / dashes / parens ok.
const phoneRegex = /^\+?[\d\s\-()]{7,20}$/;

// Address sub-form: every field optional. If the whole block is blank we store
// null (a contact needn't have an address); otherwise a JobAddress with geo
// null (no geocoding in the client book).
const optionalAddress = z
  .object({
    line1: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    region: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(12).optional(),
  })
  .optional()
  .transform((v) => {
    const line1 = v?.line1?.trim() ?? "";
    const city = v?.city?.trim() ?? "";
    const region = v?.region?.trim() ?? "";
    const postalCode = v?.postalCode?.trim() ?? "";
    if (!line1 && !city && !region && !postalCode) return null;
    return { line1, city, region, postalCode, geo: null as null };
  });

export const clientDraftSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a name").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .email("Enter a valid email")
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(phoneRegex, "Enter a valid phone number")
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  company: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v ? v : null)),
  address: optionalAddress,
});

export type ClientDraft = z.infer<typeof clientDraftSchema>;
