import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { distanceBetween, geohashQueryBounds } from "geofire-common";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";

interface JobPostLike {
  clientId?: string;
  trade?: string;
  title?: string;
  status?: string;
  addressPublic?: { city?: string; region?: string };
}

interface MetaLike {
  addressPrivate?: { geo?: { latitude: number; longitude: number } };
}

interface TradieLike {
  location?: { latitude: number; longitude: number };
  serviceRadiusKm?: number;
}

// Bounding circle for the candidate query. We don't know an individual
// tradie's serviceRadiusKm until we read their doc, so we cast a wide net
// and then per-candidate distance-filter against their own radius below.
// 200km comfortably covers the realistic upper bound (most tradies set
// 25–75km; a few rural tradies push to ~150km).
const MAX_BOUNDING_RADIUS_KM = 200;

/**
 * Fan-out: when a client posts a new job to the marketplace, notify every
 * tradesperson who matches the trade AND whose own service radius covers
 * the job's location. Direct-request notifications live in
 * jobs/onJobCreated — this trigger only fires for /jobPosts/{postId}.
 *
 * Priority is "low" (in-app only) so this never enqueues email or
 * WhatsApp regardless of the user's global channel prefs. Per-type opt-
 * out is gated by notificationPrefs.newJobPostingEnabled inside notify().
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
          .where("geohash", ">=", start)
          .where("geohash", "<=", end)
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
      const loc = t.location;
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

    const city = post.addressPublic?.city;
    const title = "New job in your area";
    const body = `${post.title ?? "A new job"}${city ? ` in ${city}` : ""}. Tap to view and apply.`;
    const link = `/jobs/posted/${postId}`;

    await Promise.all(
      eligibleUids.map((uid) =>
        notify({
          userId: uid,
          type: "new_job_posting",
          title,
          body,
          link,
          actorUid: post.clientId ?? null,
          recipientRole: "tradesperson",
          priority: "low",
        }),
      ),
    );

    logger.info("onJobPostCreated: fan-out complete", {
      postId,
      trade: post.trade,
      eligibleCount: eligibleUids.length,
    });
  },
);
