import { z } from "zod";
import { TRADES } from "@/data/trades";
import { CA_PROVINCE_CODES } from "@/data/provinces";

// Validates the EDITABLE fields of a rebate program (admin form boundary).
// Audit fields (createdAt / updatedAt / updatedBy) and lastVerifiedAt are set
// by the service, never trusted from the form. Also used by the seed-integrity
// test so the code seed can't drift out of shape.

const tradeKeys = new Set(TRADES.map((t) => t.key));
const provinceCodes = new Set(CA_PROVINCE_CODES);

export const rebateProgramSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2, "Enter a slug")
      .max(80)
      .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only"),
    name: z.string().trim().min(3, "Enter the program name").max(160),
    provider: z.string().trim().min(2, "Enter the provider").max(160),
    level: z.enum(["federal", "provincial", "municipal", "utility"]),
    national: z.boolean(),
    provinces: z
      .array(z.string().trim().toUpperCase())
      .max(13)
      .refine((arr) => arr.every((c) => provinceCodes.has(c)), {
        message: "Use valid Canadian province codes",
      }),
    trades: z
      .array(z.string())
      .min(1, "Pick at least one trade")
      .refine((arr) => arr.every((t) => tradeKeys.has(t)), {
        message: "Unknown trade key",
      }),
    summary: z.string().trim().min(10, "Add a short summary").max(400),
    amountNote: z.string().trim().max(300),
    eligibilityNote: z
      .string()
      .trim()
      .min(5, "Add the key eligibility conditions")
      .max(800),
    officialUrl: z
      .string()
      .trim()
      .url("Enter a valid URL")
      .startsWith("https://", "Must be an https link")
      .max(500),
    status: z.enum(["active", "closed", "paused"]),
  })
  // A program is either Canada-wide, or it lists the provinces it applies to —
  // never both empty (that would match nothing and mislead).
  .refine((p) => p.national || p.provinces.length > 0, {
    message: "Mark it national, or list at least one province",
    path: ["provinces"],
  });

export type RebateProgramInput = z.infer<typeof rebateProgramSchema>;
