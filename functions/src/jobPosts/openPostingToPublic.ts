// Public-board fallback for a SCOPED ("invited") PM posting (P3b-2b): when none of
// the project manager's preferred contractors bid, the client opens the job to the
// whole verified-trades board. Flips status invited -> open and clears
// invitedContractorIds (so the invitee uids never reach the public board), and
// geocodes the address the client confirmed at accept so the post enters the
// proximity feed. The meta's preferredContractorIds is left intact, so a preferred
// contractor who wins even after the fallback still earns the PM commission.
//
// Geocoding happens client-side (Google Maps isn't available in functions); the
// client passes the resolved lat/lng of the address it already confirmed.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { GeoPoint } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRoleOrAdmin } from "../lib/auth";
import { deriveGeohashes } from "./helpers";

const Input = z.object({
  postId: z.string().min(1).max(128),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

interface PostData {
  clientId: string;
  status: string;
}

export const openPostingToPublic = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRoleOrAdmin(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { postId, lat, lng } = parsed.data;

  const postRef = db.doc(`jobPosts/${postId}`);
  const metaRef = postRef.collection("private").doc("meta");
  const snap = await postRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Job post not found.");
  const post = snap.data() as PostData;
  if (post.clientId !== uid) throw new HttpsError("permission-denied", "Not your post.");
  if (post.status !== "invited") {
    throw new HttpsError("failed-precondition", "This posting isn't a scoped invite.");
  }

  const { geohashExact, geohashPublic } = deriveGeohashes(lat, lng);

  const batch = db.batch();
  batch.update(postRef, {
    status: "open",
    invitedContractorIds: [],
    "addressPublic.geohashPublic": geohashPublic,
  });
  batch.update(metaRef, {
    "addressPrivate.geo": new GeoPoint(lat, lng),
    "addressPrivate.geohashExact": geohashExact,
  });
  await batch.commit();

  logger.info("openPostingToPublic: opened", { uid, postId });
  return { ok: true as const };
});
