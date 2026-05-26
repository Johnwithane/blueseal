// One-shot admin callable: backfill `clientName` (first-name only) +
// `clientPhotoURL` on /jobPosts docs that pre-date the denormalization
// landed in createJobPost. Without these fields the browse-jobs feed and
// post-detail header render a generic "Client" + "C" initial avatar
// instead of the actual poster's name + photo.
//
// New posts already carry the fields (createJobPost writes them at
// post-creation time). This callable retroactively fills them in for
// legacy rows so the browse feed is uniformly populated.
//
// Why a callable: the admin SDK bypasses Firestore rules, which is
// exactly what we need to read /users/{clientId} (owner+admin only at
// the rule layer). Wrapping it in an admin-gated onCall keeps the
// operation auditable and re-runnable from the admin dashboard.
//
// Idempotent: re-running is a no-op for posts that already carry
// `clientName`. Paginated at 400 docs per batch (Firestore's WriteBatch
// hard limit is 500; 400 leaves headroom for retries).
//
// User-lookup failures (deleted client, missing displayName) fall back
// to "Client" + null photo so the row still renders something sensible.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { firstNameOnly } from "../jobPosts/helpers";

const PAGE_SIZE = 400;

interface BackfillResult {
  scanned: number;
  updated: number;
  alreadyPresent: number;
  pages: number;
  // Posts we couldn't enrich because the client's user doc no longer
  // exists or had no displayName. Stamped with the generic fallback so
  // the row still reads — count is surfaced so the admin can spot a
  // pattern.
  fallbackUsed: number;
}

interface UserSnapshot {
  clientName: string;
  photoURL: string | null;
}

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
      clientName: firstNameOnly(data?.displayName),
      photoURL: data?.photoURL ?? null,
    };
    cache.set(clientId, result);
    return result;
  } catch (err) {
    logger.warn("backfillJobPostClient: user lookup failed", { clientId, err });
    const fallback: UserSnapshot = { clientName: "Client", photoURL: null };
    cache.set(clientId, fallback);
    return fallback;
  }
}

export const backfillJobPostClient = onCall(
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

    while (true) {
      let query = db.collection("jobPosts").limit(PAGE_SIZE);
      if (lastDocId) {
        const cursor = await db.doc(`jobPosts/${lastDocId}`).get();
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
          continue;
        }
        const profile = await readClientSnapshot(userCache, clientId);
        if (profile.clientName === "Client" && !profile.photoURL) {
          fallbackUsed += 1;
        }
        batch.update(docSnap.ref, {
          clientName: profile.clientName,
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
      action: "backfillJobPostClient",
      targetType: "jobPosts",
      targetId: "*",
      metadata: { scanned, updated, alreadyPresent, pages, fallbackUsed },
    });

    logger.info("backfillJobPostClient: done", {
      scanned,
      updated,
      alreadyPresent,
      pages,
      fallbackUsed,
      uniqueClientsLookedUp: userCache.size,
      actor,
    });

    if (scanned === 0) {
      throw new HttpsError(
        "not-found",
        "No job posts found. Backfill had nothing to do.",
      );
    }

    return { scanned, updated, alreadyPresent, pages, fallbackUsed };
  },
);
