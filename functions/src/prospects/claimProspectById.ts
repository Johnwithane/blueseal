// Authenticated callable: claim a SPECIFIC seeded listing by id (the path used
// when a tradesperson finds their own listing during signup — the scraped set
// has no email, so the email-hash claimProspect path can't match it).
//
// This only ever produces a DRAFT tradesperson profile (isVisible:false). Going
// live still requires passing the normal cert + ID vetting, which is the real
// proof of ownership — so a mis-claim can't reach the public directory. The
// listing is marked claimed (not deleted) so it leaves the pool but stays
// reversible by an admin if a claim is ever disputed.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, GeoPoint } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { buildProspectDraft, emailHashOf, prospectDraftOverlay } from "./helpers";

const Input = z.object({ prospectId: z.string().trim().min(1).max(64) });

export const claimProspectById = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input.");

  const ref = db.doc(`prospects/${parsed.data.prospectId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That listing no longer exists.");
  const p = snap.data() as Record<string, unknown>;
  if (p.status === "claimed") {
    throw new HttpsError("failed-precondition", "That listing has already been claimed.");
  }
  if (p.status === "suppressed") {
    throw new HttpsError("failed-precondition", "That listing isn't available.");
  }

  // Durable first write: out of the pool + marked claimed.
  const email = (req.auth?.token as { email?: string } | undefined)?.email;
  await ref.update({
    status: "claimed",
    isListed: false,
    claimedByUid: uid,
    claimedAt: FieldValue.serverTimestamp(),
    ...(email ? { emailHash: emailHashOf(email) } : {}),
  });

  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = (userSnap.data() ?? {}) as { displayName?: unknown; photoURL?: unknown };

  // Migrate into tradespeople/{uid} draft (same shape as the email-claim path).
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const tradieSnap = await tradieRef.get();
  if (!tradieSnap.exists) {
    await tradieRef.set(buildProspectDraft(p, userData));
    await tradieRef
      .collection("private")
      .doc("contact")
      .set(
        {
          location: (p.locationApprox as GeoPoint | null) ?? new GeoPoint(0, 0),
          primaryAddressText: typeof p.locationLabel === "string" ? p.locationLabel : "",
          businessAddress: null,
          businessPhone: null,
          gstNumber: null,
        },
        { merge: true },
      );
  } else {
    // Only overlay the seeded fields onto an untouched draft (never clobber a
    // profile they've already started editing or submitted for vetting).
    const td = tradieSnap.data() as { vettingStatus?: string; submittedAt?: unknown };
    if (td.vettingStatus === "draft" && !td.submittedAt) {
      await tradieRef.set(prospectDraftOverlay(p), { merge: true });
    }
  }

  logger.info("claimProspectById: claimed", { uid, prospectId: parsed.data.prospectId });
  return { status: "claimed" as const };
});
