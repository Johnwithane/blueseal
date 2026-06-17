import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { distanceBetween, geohashQueryBounds } from "geofire-common";
import { db } from "../lib/admin";

interface JobPostLike {
  clientId?: string;
  trade?: string;
  status?: string;
}

interface MetaLike {
  addressPrivate?: { geo?: { latitude: number; longitude: number } };
}

interface TradieLike {
  // Coarse public location (~1km); exact location is private now. Good enough
  // for an "in your area" notification radius check.
  locationApprox?: { latitude: number; longitude: number };
  serviceRadiusKm?: number;
}

// Bounding circle for the candidate query. We don't know an individual
// tradie's serviceRadiusKm until we read their doc, so we cast a wide net
// and then per-candidate distance-filter against their own radius below.
// 200km comfortably covers the realistic upper bound (most tradies set
// 25–75km; a few rural tradies push to ~150km).
const MAX_BOUNDING_RADIUS_KM = 200;

/**
 * Fan-out: when a client posts a new job to the marketplace, flag it for every
 * tradesperson who matches the trade AND whose own service radius covers the
 * job's location. Direct-request notifications live in jobs/onJobCreated — this
 * trigger only fires for /jobPosts/{postId}.
 *
 * This used to write one bell notification per eligible tradesperson per post,
 * which buried the transactional inbox under "New job in your area" rows (the
 * feedback that prompted this rewrite). Instead we increment a per-user counter
 * (jobBoardCounters/{uid}) that the header renders as an unread BADGE on
 * "Browse open jobs"; opening the board resets it. The new-jobs signal is a
 * marketplace feed, not a personal/transactional event, so it belongs on the
 * board's nav affordance — not in the bell. The newJobPostingEnabled opt-out is
 * still honoured (checked here now that we no longer route through notify()).
 */
export const onJobPostCreated = onDocumentCreated(
  "jobPosts/{postId}",
  async (event) => {
    const postId = event.params.postId;
    const post = event.data?.data() as JobPostLike | undefined;
    if (!post?.trade || !post.clientId) return;
    if (post.status !== "open") return;

    // Exact coords live in /private/meta — the parent doc only has the
    // length-6 geohashPublic (~1.2km cell), too coarse for radius checks.
    const metaSnap = await db.doc(`jobPosts/${postId}/private/meta`).get();
    const meta = metaSnap.data() as MetaLike | undefined;
    const geo = meta?.addressPrivate?.geo;
    if (!geo) {
      logger.warn("onJobPostCreated: post missing private geo", { postId });
      return;
    }
    const postLat = geo.latitude;
    const postLng = geo.longitude;

    const bounds = geohashQueryBounds(
      [postLat, postLng],
      MAX_BOUNDING_RADIUS_KM * 1000,
    );

    const candidates = new Map<string, TradieLike>();
    await Promise.all(
      bounds.map(async ([start, end]) => {
        const snap = await db
          .collection("tradespeople")
          .where("trades", "array-contains", post.trade)
          .where("isVisible", "==", true)
          .where("geohashPublic", ">=", start)
          .where("geohashPublic", "<=", end)
          .limit(500)
          .get();
        for (const d of snap.docs) {
          candidates.set(d.id, d.data() as TradieLike);
        }
      }),
    );

    const eligibleUids: string[] = [];
    for (const [uid, t] of candidates) {
      if (uid === post.clientId) continue;
      const loc = t.locationApprox;
      const radius = t.serviceRadiusKm;
      if (!loc || typeof radius !== "number") continue;
      const distKm = distanceBetween(
        [loc.latitude, loc.longitude],
        [postLat, postLng],
      );
      if (distKm <= radius) eligibleUids.push(uid);
    }

    if (eligibleUids.length === 0) {
      logger.info("onJobPostCreated: no eligible tradies", {
        postId,
        trade: post.trade,
      });
      return;
    }

    const recipients = await filterByJobPostingPref(eligibleUids);
    if (recipients.length === 0) {
      logger.info("onJobPostCreated: all eligible tradies opted out", { postId });
      return;
    }

    await bumpJobBoardCounters(recipients);

    logger.info("onJobPostCreated: badge fan-out complete", {
      postId,
      trade: post.trade,
      eligibleCount: eligibleUids.length,
      notifiedCount: recipients.length,
    });
  },
);

// Firestore batched writes cap at 500 ops; stay under it with headroom so a
// dense urban fan-out (hundreds of matching tradies) chunks cleanly.
const COUNTER_BATCH_LIMIT = 450;

/**
 * Drop tradespeople who've opted out of new-job alerts
 * (notificationPrefs.newJobPostingEnabled === false). Missing pref = enabled,
 * matching the legacy-friendly default in lib/notify's getUserContact. A read
 * failure keeps the recipient — a transient miss shouldn't silently swallow a
 * lead.
 */
async function filterByJobPostingPref(uids: string[]): Promise<string[]> {
  const results = await Promise.all(
    uids.map(async (uid) => {
      try {
        const snap = await db.doc(`users/${uid}`).get();
        const prefs = (snap.data()?.notificationPrefs ?? {}) as {
          newJobPostingEnabled?: boolean;
        };
        return prefs.newJobPostingEnabled !== false ? uid : null;
      } catch (err) {
        logger.warn("onJobPostCreated: pref read failed; keeping recipient", { uid, err });
        return uid;
      }
    }),
  );
  return results.filter((u): u is string => u !== null);
}

/**
 * Bump each recipient's jobBoardCounters/{uid}.count by one. merge:true so the
 * first post for a user creates the doc and later posts add to it; the client
 * resets count to 0 (the only client-side write rules permit) when the
 * tradesperson opens the board.
 */
async function bumpJobBoardCounters(uids: string[]): Promise<void> {
  for (let i = 0; i < uids.length; i += COUNTER_BATCH_LIMIT) {
    const batch = db.batch();
    for (const uid of uids.slice(i, i + COUNTER_BATCH_LIMIT)) {
      batch.set(
        db.doc(`jobBoardCounters/${uid}`),
        {
          count: FieldValue.increment(1),
          lastJobAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
}
