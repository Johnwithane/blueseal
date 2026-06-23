// Public callable: return a seeded prospect's PUBLIC profile fields for the
// shareable preview page (/p/:id). This is what the prospect sees from the
// outreach email ("here's the profile we drafted for you") and what an admin
// opens via "Preview profile". It deliberately excludes the private contact
// (email/phone) and the provenance/consent internals — only the profile a
// claimed tradesperson would show publicly anyway. App Check (CALLABLE_OPTS)
// keeps it to our own app; the doc id is a 96-bit hash, so it isn't enumerable.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";

const Input = z.object({ prospectId: z.string().trim().min(1).max(64) });

export const getProspectPreview = onCall(CALLABLE_OPTS, async (req) => {
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input.");

  const snap = await db.doc(`prospects/${parsed.data.prospectId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "That listing was not found.");
  const p = snap.data() as Record<string, unknown>;
  // A suppressed (opted-out / taken-down) listing must not be viewable.
  if (p.status === "suppressed") throw new HttpsError("not-found", "That listing was not found.");

  return {
    displayName: typeof p.displayName === "string" ? p.displayName : "",
    companyName: (p.companyName as string | null) ?? null,
    bio: typeof p.bio === "string" ? p.bio : "",
    trades: Array.isArray(p.trades) ? p.trades : [],
    services: Array.isArray(p.services) ? p.services : [],
    yearsExperience:
      p.yearsExperience && typeof p.yearsExperience === "object" ? p.yearsExperience : {},
    pricingModel: typeof p.pricingModel === "string" ? p.pricingModel : "quote",
    hourlyRate: typeof p.hourlyRate === "number" ? p.hourlyRate : null,
    languages: Array.isArray(p.languages) ? p.languages : [],
    serviceRadiusKm: typeof p.serviceRadiusKm === "number" ? p.serviceRadiusKm : null,
    locationLabel: (p.locationLabel as string | null) ?? null,
    website: (p.website as string | null) ?? null,
    photoURL: typeof p.photoURL === "string" ? p.photoURL : null,
    companyLogoUrl: typeof p.companyLogoUrl === "string" ? p.companyLogoUrl : null,
    portfolioPhotos: Array.isArray(p.portfolioPhotos) ? p.portfolioPhotos : [],
    claimed: p.status === "claimed",
  };
});
