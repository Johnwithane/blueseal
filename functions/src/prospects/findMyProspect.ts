// Authenticated callable: let a signing-up tradesperson find their OWN seeded
// listing so they can claim it. Seeded listings are private (admin-read only),
// and the scraped set has no email to match on, so claiming can't go through the
// email-hash path — they search by business name + town instead, and this
// returns safe public previews of the unclaimed matches.
//
// Narrowed by town (a single-field index, no composite needed) so we never scan
// the whole pool per call.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

const Input = z.object({
  name: z.string().trim().min(2).max(120),
  locationLabel: z.string().trim().min(1).max(80),
});

export const findMyProspect = onCall(CALLABLE_OPTS, async (req) => {
  requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Enter your business name and town.");
  const { name, locationLabel } = parsed.data;
  const needle = name.toLowerCase();

  const snap = await db
    .collection("prospects")
    .where("locationLabel", "==", locationLabel)
    .limit(500)
    .get();

  const matches = snap.docs
    .map(
      (d) =>
        ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as Record<string, unknown> & {
          id: string;
        },
    )
    .filter((p) => p.status === "listed" || p.status === "outreach_sent")
    .filter((p) => {
      const hay = `${p.displayName ?? ""} ${p.companyName ?? ""}`.toLowerCase();
      return hay.includes(needle);
    })
    .slice(0, 8)
    .map((p) => ({
      id: p.id as string,
      displayName: (p.displayName as string) ?? "",
      companyName: (p.companyName as string | null) ?? null,
      locationLabel: (p.locationLabel as string | null) ?? null,
      trades: Array.isArray(p.trades) ? (p.trades as string[]) : [],
      photoURL: typeof p.photoURL === "string" ? p.photoURL : null,
      googleRating: typeof p.googleRating === "number" ? p.googleRating : null,
      googleReviewCount: typeof p.googleReviewCount === "number" ? p.googleReviewCount : 0,
    }));

  return { matches };
});
