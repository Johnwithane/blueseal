import { z } from "zod";
import { CA_PROVINCE_CODES } from "@/data/provinces";

// Validates the EDITABLE fields of a sales region (admin form boundary). The
// audit fields (createdAt / updatedAt / updatedBy), the denormalized health
// counts, and the marketing budget state are all set server-side by the
// adminUpsertRegion callable, never trusted from the form. The same shape is
// mirrored in functions/src/sales/upsertRegion.ts (functions is a separate
// package and can't import app source).

const provinceCodes = new Set(CA_PROVINCE_CODES);

// A postal FSA prefix: 1-3 chars, Letter[Digit[Letter]] (e.g. "V", "V8", "V8W").
const FSA_PREFIX = /^[A-Z][0-9]?[A-Z]?$/;

export const regionSchema = z.object({
  // Present on edit, absent on create — the callable uses it to decide which.
  id: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(2, "Name the region").max(80),
  province: z
    .string()
    .trim()
    .toUpperCase()
    .refine((c) => provinceCodes.has(c), "Use a valid Canadian province code"),
  fsaPrefixes: z
    .array(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(FSA_PREFIX, "Use postal (FSA) prefixes like V8 or V8W"),
    )
    .min(1, "Add at least one postal (FSA) prefix")
    .max(300)
    .refine((arr) => new Set(arr).size === arr.length, "Prefixes must be unique"),
  repId: z.string().trim().min(1).max(128).nullable(),
  status: z.enum(["active", "paused"]),
  thresholdActive: z.number().int().min(1).max(100000),
});

export type RegionInput = z.infer<typeof regionSchema>;
