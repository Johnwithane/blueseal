import { HttpsError } from "firebase-functions/v2/https";
import { geohashForLocation } from "geofire-common";
import { db } from "../lib/admin";

// Server-side geohash derivation. Two precisions:
// - exact (length 9): stored in /private/meta, only the post owner + selected
//   tradie + admin can read it.
// - public (length 6, ~1.2km cell): stored on the parent doc; coarse enough
//   that it doesn't expose the home address, fine enough that radius-bounded
//   proximity queries still work.
export function deriveGeohashes(lat: number, lng: number) {
  const full = geohashForLocation([lat, lng]);
  return {
    geohashExact: full.slice(0, 9),
    geohashPublic: full.slice(0, 6),
  };
}

export async function requireVisibleTradie(uid: string): Promise<void> {
  const snap = await db.doc(`tradespeople/${uid}`).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Tradesperson profile not found.");
  }
  const data = snap.data() as { isVisible?: boolean } | undefined;
  if (!data?.isVisible) {
    throw new HttpsError(
      "failed-precondition",
      "Your account must be approved before you can apply to jobs.",
    );
  }
}

export interface JobPostState {
  clientId: string;
  status: "open" | "closed" | "cancelled" | "expired";
  expiresAt?: { toMillis(): number };
}

export async function loadOpenPostOrThrow(postId: string): Promise<JobPostState> {
  const snap = await db.doc(`jobPosts/${postId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Job post not found.");
  const data = snap.data() as JobPostState;
  if (data.status !== "open") {
    throw new HttpsError("failed-precondition", "This job post is no longer open.");
  }
  return data;
}

// Per-(uid, day) rate-limit doc id like "tradieUid_2026-05-21". Caller bumps
// the count in a transaction and throws resource-exhausted if over the cap.
export function rateLimitKey(uid: string, action: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${action}_${uid}_${today}`;
}
