// One-shot admin callable: backfill `clientName` + `clientPhotoURL` on
// /reviews docs that pre-date the denormalization landed in ReviewPrompt.
// Without these fields the public tradesperson profile renders a generic
// "Client" + "C" initial instead of the actual reviewer's name + photo.
//
// New reviews already carry the fields (ReviewPrompt resolves them from
// auth.store at submit time). This callable retroactively fills them in
// for the legacy rows so the profile reads correctly across history.
//
// Why a callable (not a script): the admin SDK bypasses Firestore rules,
// which is exactly what we need to read /users/{clientId} (owner+admin
// only at the rule level). Wrapping it in an admin-gated onCall keeps
// the operation auditable and re-runnable from the admin dashboard
// without anyone having to wire up local service-account credentials.
//
// Idempotent: re-running is a no-op for reviews that already carry
// `clientName`. Paginated at 400 docs per batch (Firestore's WriteBatch
// hard limit is 500; 400 leaves headroom for retries).
//
// User-lookup failures (deleted client, missing displayName) fall back
// to "Client" + null photo so the row still renders something sensible
// — the alternative (skipping those reviews) would leave the "Client"
// label visible forever, which is the exact bug we're fixing.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

const PAGE_SIZE = 400;

interface BackfillResult {
  scanned: number;
  updated: number;
  alreadyPresent: number;
  pages: number;
  // Reviews we couldn't enrich because the client's user doc no longer
  // exists (account deleted) or had no displayName. Stamped with the
  // generic fallback so the row still reads — count is surfaced so the
  // admin can spot a pattern (mass deletion, signup form bug).
  fallbackUsed: number;
}

interface UserSnapshot {
  displayName: string;
  photoURL: string | null;
}

// Per-run cache of user lookups — many reviews can come from the same
// client (repeat customer), and re-reading their /users doc each time
// would burn quota for no reason. Cleared on every callable invocation
// since it lives in-memory inside the request scope.
async function readClientSnapshot(
  cache: Map<string, UserSnapshot>,
  clientId: string,
): Promise<UserSnapshot> {
  const hit = cache.get(clientId);
  if (hit) return hit;
  try {
    const snap = await db.doc(`users/${clientId}`).get();
    const data = snap.data() as
      | { displayName?: string; photoURL?: string | null }
      | undefined;
    const result: UserSnapshot = {
      displayName: (data?.displayName ?? "").trim() || "Client",
      photoURL: data?.photoURL ?? null,
    };
    cache.set(clientId, result);
    return result;
  } catch (err) {
    logger.warn("backfillReviewReviewers: user lookup failed", { clientId, err });
    const fallback: UserSnapshot = { displayName: "Client", photoURL: null };
    cache.set(clientId, fallback);
    return fallback;
  }
}

export const backfillReviewReviewers = onCall(
  { enforceAppCheck: false },
  async (req): Promise<BackfillResult> => {
    const actor = requireAdmin(req);

    let scanned = 0;
    let updated = 0;
    let alreadyPresent = 0;
    let pages = 0;
    let fallbackUsed = 0;
    let lastDocId: string | null = null;
    const userCache = new Map<string, UserSnapshot>();

    // Page by document id (deterministic ordering on __name__). Same
    // pattern as backfillPayoutsField — a long run interrupted halfway
    // is safe to re-invoke; touched pages are no-ops on the second pass.
    while (true) {
      let query = db.collection("reviews").limit(PAGE_SIZE);
      if (lastDocId) {
        const cursor = await db.doc(`reviews/${lastDocId}`).get();
        query = query.startAfter(cursor);
      }
      const snap = await query.get();
      if (snap.empty) break;
      pages += 1;
      scanned += snap.size;

      const batch = db.batch();
      let batchWrites = 0;
      for (const docSnap of snap.docs) {
        const existing = docSnap.get("clientName");
        if (typeof existing === "string" && existing.trim().length > 0) {
          alreadyPresent += 1;
          continue;
        }
        const clientId = docSnap.get("clientId");
        if (typeof clientId !== "string" || !clientId) {
          // Malformed legacy doc — can't enrich without a clientId.
          // Skip rather than write a placeholder, so the admin can spot
          // it later via scanned-vs-updated drift.
          continue;
        }
        const profile = await readClientSnapshot(userCache, clientId);
        if (profile.displayName === "Client" && !profile.photoURL) {
          fallbackUsed += 1;
        }
        batch.update(docSnap.ref, {
          clientName: profile.displayName,
          clientPhotoURL: profile.photoURL,
        });
        batchWrites += 1;
      }
      if (batchWrites > 0) {
        await batch.commit();
        updated += batchWrites;
      }

      lastDocId = snap.docs[snap.docs.length - 1].id;
      if (snap.size < PAGE_SIZE) break;
    }

    await logAdminAction({
      actorUid: actor,
      action: "backfillReviewReviewers",
      targetType: "reviews",
      targetId: "*",
      metadata: { scanned, updated, alreadyPresent, pages, fallbackUsed },
    });

    logger.info("backfillReviewReviewers: done", {
      scanned,
      updated,
      alreadyPresent,
      pages,
      fallbackUsed,
      uniqueClientsLookedUp: userCache.size,
      actor,
    });

    if (scanned === 0) {
      // The /reviews collection is empty. Surface as not-found so the
      // admin UI doesn't claim success when nothing happened.
      throw new HttpsError(
        "not-found",
        "No reviews found. Backfill had nothing to do.",
      );
    }

    return { scanned, updated, alreadyPresent, pages, fallbackUsed };
  },
);
