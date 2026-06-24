// Authenticated callable: a Pro tradesperson claims (or changes) the vanity
// handle for their public profile — blueseal.app/u/<slug>. Uniqueness is
// enforced through a profileSlugs/{slug} registry doc (id == the slug) inside a
// transaction, so two people can't grab the same handle in a race. The handle
// is mirrored onto tradespeople/{uid}.slug (server-managed; locked for owner
// writes in firestore.rules), and the previous handle's registry doc is freed.
//
// Pro-gated via requireProEntitlement, which throws the BLUESEAL_PRO_REQUIRED
// token the client paywall catches.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRoleOrAdmin } from "../lib/auth";
import { requireProEntitlement } from "../lib/entitlements";
import { isValidSlug } from "../lib/slug";

const Input = z.object({ slug: z.string().trim().toLowerCase().min(1).max(64) });

export const claimProfileSlug = onCall(CALLABLE_OPTS, async (req) => {
  // Tradesperson claiming their own handle (admins allowed, for support/testing).
  // Either way it only ever writes to tradespeople/{their own uid}.
  const uid = requireRoleOrAdmin(req, "tradesperson");

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid handle.");
  const slug = parsed.data.slug;
  if (!isValidSlug(slug)) {
    throw new HttpsError(
      "invalid-argument",
      "Use 3-30 lowercase letters, numbers or hyphens (and not a reserved word).",
    );
  }

  await requireProEntitlement(
    uid,
    "A custom profile link (blueseal.app/u/your-name) is part of Blue Seal Pro.",
  );

  const slugRef = db.doc(`profileSlugs/${slug}`);
  const tradieRef = db.doc(`tradespeople/${uid}`);

  await db.runTransaction(async (tx) => {
    // All reads first (Firestore transaction rule).
    const [slugSnap, tradieSnap] = await Promise.all([tx.get(slugRef), tx.get(tradieRef)]);
    if (!tradieSnap.exists) {
      throw new HttpsError("failed-precondition", "Set up your tradesperson profile first.");
    }
    if (slugSnap.exists && slugSnap.get("uid") !== uid) {
      throw new HttpsError("already-exists", "That handle is taken. Try another.");
    }
    const oldSlug = (tradieSnap.get("slug") as string | undefined) ?? null;
    // Free the previous handle so it becomes claimable again.
    if (oldSlug && oldSlug !== slug) {
      tx.delete(db.doc(`profileSlugs/${oldSlug}`));
    }
    tx.set(slugRef, { uid, claimedAt: FieldValue.serverTimestamp() });
    tx.update(tradieRef, { slug });
  });

  logger.info("claimProfileSlug: claimed", { uid, slug });
  return { slug };
});
