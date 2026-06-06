// Shared connect/sync/teardown logic for Google Business reviews, used by the
// OAuth callback (initial sync), the manual "Sync now" callable, the daily
// scheduled refresh, and disconnect. Keeps the Firestore shapes + the
// refresh→fetch→write pipeline in one place.

import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { MAX_SNAPSHOT_REVIEWS, decryptToken, encryptToken } from "./config";
import {
  type GoogleLocation,
  listReviews,
  refreshAccessToken,
  revokeToken,
} from "./api";

// Server-only doc holding the encrypted refresh token + which location is
// connected. Lives under tradespeople/{uid}/secure/* which firestore.rules
// denies to ALL clients (owner included) — only the Admin SDK reads it.
const secureRef = (uid: string) => db.doc(`tradespeople/${uid}/secure/google`);
const publicRef = (uid: string) => db.doc(`tradespeople/${uid}`);

interface SecureGoogleDoc {
  refreshTokenEnc: string;
  accountId: string;
  locationId: string;
  title: string;
  mapsUri: string | null;
  newReviewUri: string | null;
}

export interface SyncResult {
  connected: boolean;
  rating: number | null;
  reviewCount: number;
  error: string | null;
}

// Persist the connection after a successful OAuth exchange. Encrypts the refresh
// token before it touches Firestore. Then runs an immediate sync so the public
// snapshot is populated by the time the tradesperson lands back in the app.
export async function saveConnection(
  uid: string,
  refreshToken: string,
  loc: GoogleLocation,
): Promise<SyncResult> {
  const data: SecureGoogleDoc & { connectedAt: FieldValue; lastSyncAt: null; lastError: null } = {
    refreshTokenEnc: encryptToken(refreshToken),
    accountId: loc.accountId,
    locationId: loc.locationId,
    title: loc.title,
    mapsUri: loc.mapsUri,
    newReviewUri: loc.newReviewUri,
    connectedAt: FieldValue.serverTimestamp(),
    lastSyncAt: null,
    lastError: null,
  };
  await secureRef(uid).set(data);
  return syncReviewsForTradie(uid);
}

// Refresh one tradesperson's cached Google reviews. Never throws — failures are
// recorded on the snapshot + secure doc so the scheduled fan-out keeps going and
// the UI can show "couldn't refresh". Returns connected:false when there's no
// connection to sync.
export async function syncReviewsForTradie(uid: string): Promise<SyncResult> {
  const snap = await secureRef(uid).get();
  if (!snap.exists) return { connected: false, rating: null, reviewCount: 0, error: null };
  const secure = snap.data() as SecureGoogleDoc;

  try {
    const accessToken = await refreshAccessToken(decryptToken(secure.refreshTokenEnc));
    const result = await listReviews(
      accessToken,
      secure.accountId,
      secure.locationId,
      MAX_SNAPSHOT_REVIEWS,
    );

    await publicRef(uid).set(
      {
        googleReviews: {
          connected: true,
          locationName: secure.title || null,
          profileUrl: secure.mapsUri ?? secure.newReviewUri ?? null,
          rating: result.rating,
          reviewCount: result.reviewCount,
          reviews: result.reviews.map((r) => ({
            reviewId: r.reviewId,
            authorName: r.authorName,
            authorPhotoUrl: r.authorPhotoUrl,
            rating: r.rating,
            // Cap comment length so a long review can't bloat the public doc.
            comment: r.comment.slice(0, 1200),
            createTime: r.createTime,
          })),
          lastSyncedAt: FieldValue.serverTimestamp(),
          syncError: null,
        },
      },
      { merge: true },
    );
    await secureRef(uid).update({ lastSyncAt: FieldValue.serverTimestamp(), lastError: null });
    return { connected: true, rating: result.rating, reviewCount: result.reviewCount, error: null };
  } catch (err) {
    const message = (err as Error)?.message ?? "sync failed";
    logger.error("google.syncReviewsForTradie failed", { uid, message });
    // Surface a friendly flag on the public snapshot (preserving any
    // previously-synced rating/reviews) and stash the raw error privately.
    await publicRef(uid).set(
      { googleReviews: { connected: true, syncError: "couldn't refresh" } },
      { merge: true },
    );
    await secureRef(uid).update({ lastError: message }).catch(() => undefined);
    return { connected: true, rating: null, reviewCount: 0, error: message };
  }
}

// Tear down a connection: revoke the token with Google (best-effort), delete the
// secure doc, and clear the public snapshot so the profile stops showing Google
// reviews immediately.
export async function disconnectTradie(uid: string): Promise<void> {
  const snap = await secureRef(uid).get();
  if (snap.exists) {
    const secure = snap.data() as SecureGoogleDoc;
    try {
      await revokeToken(decryptToken(secure.refreshTokenEnc));
    } catch (err) {
      logger.warn("google.disconnectTradie: revoke skipped", { uid, err });
    }
    await secureRef(uid).delete();
  }
  await publicRef(uid).set({ googleReviews: null }, { merge: true });
}
