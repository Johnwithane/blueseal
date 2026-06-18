// Validation for the Business Card Generator form. Local-only (no Firestore
// write yet) — but every form gets a schema so the editable copy stays within
// the bounds the canvas layout was designed for (over-long strings either wrap
// past the safe area or get truncated). Lengths are deliberately tight: a
// business card has very little room.
import { z } from "zod";

export const CARD_TYPES = [
  "tradesperson_signup",
  "client_search",
  "tradesperson_profile",
] as const;

export const CARD_THEMES = ["cream", "navy"] as const;

export const businessCardConfigSchema = z.object({
  type: z.enum(CARD_TYPES),
  theme: z.enum(CARD_THEMES),
  // Message fields (used by signup + client cards).
  headline: z.string().trim().max(60, "Headline is too long for the card").default(""),
  subcopy: z.string().trim().max(160, "Sub-copy is too long for the card").default(""),
  qrCaption: z.string().trim().min(1, "Add a scan caption").max(28, "Caption is too long"),
  campaign: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z0-9_-]*$/i, "Letters, numbers, - and _ only")
    .default(""),
  includeBrandmark: z.boolean().default(true),
  // Profile-card only.
  profileUid: z.string().trim().max(128).default(""),
  profileName: z.string().trim().max(60).default(""),
  profileCompany: z.string().trim().max(60).default(""),
  profileTrade: z.string().trim().max(48).default(""),
  profileEmail: z.string().trim().max(80).default(""),
  profilePhone: z.string().trim().max(32).default(""),
  showEmail: z.boolean().default(true),
  showPhone: z.boolean().default(true),
  showPhoto: z.boolean().default(true),
});

export type BusinessCardConfig = z.infer<typeof businessCardConfigSchema>;
