// Authenticated callable: a project manager claims (or changes) the vanity handle
// for their PUBLIC profile — blueseal.app/pm/<slug>. Mirrors claimProfileSlug, but
// for a PM: uniqueness is enforced through a SEPARATE pmProfileSlugs/{slug} registry
// (so PM and tradesperson handles live in independent namespaces — /pm/x and /u/x
// can coexist), the handle is mirrored onto projectManagers/{uid}.slug
// (server-managed; locked for owner writes in firestore.rules), and the previous
// handle is freed. NOT Pro-gated: a public PM profile is free + instant (no vetting).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requirePmActive } from "../lib/projectManager";
import { isValidSlug } from "../lib/slug";

const Input = z.object({ slug: z.string().trim().toLowerCase().min(1).max(64) });

export const claimPmProfileSlug = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "projectManager");
  await requirePmActive(uid);

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid handle.");
  const slug = parsed.data.slug;
  if (!isValidSlug(slug)) {
    throw new HttpsError(
      "invalid-argument",
      "Use 3-30 lowercase letters, numbers or hyphens (and not a reserved word).",
    );
  }

  const slugRef = db.doc(`pmProfileSlugs/${slug}`);
  const profileRef = db.doc(`projectManagers/${uid}`);

  await db.runTransaction(async (tx) => {
    const [slugSnap, profileSnap] = await Promise.all([tx.get(slugRef), tx.get(profileRef)]);
    if (!profileSnap.exists) {
      throw new HttpsError("failed-precondition", "Set up your public profile first.");
    }
    if (slugSnap.exists && slugSnap.get("uid") !== uid) {
      throw new HttpsError("already-exists", "That handle is taken. Try another.");
    }
    const oldSlug = (profileSnap.get("slug") as string | undefined) ?? null;
    if (oldSlug && oldSlug !== slug) {
      tx.delete(db.doc(`pmProfileSlugs/${oldSlug}`));
    }
    tx.set(slugRef, { uid, claimedAt: FieldValue.serverTimestamp() });
    tx.update(profileRef, { slug });
  });

  logger.info("claimPmProfileSlug: claimed", { uid, slug });
  return { slug };
});
