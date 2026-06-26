import { z } from "zod";

// A project manager's property (an address/unit they manage). Validated at the
// form boundary; the service adds the server-managed fields (projectManagerId,
// linkedClientId, timestamps).
export const propertySchema = z.object({
  label: z.string().trim().min(1, "Add a label").max(120),
  addressText: z.string().trim().max(300).default(""),
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .transform((v) => (v ? v : null))
    .default(null),
  photoUrl: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .transform((v) => (v ? v : null))
    .default(null),
});

export type PropertyDraft = z.infer<typeof propertySchema>;
