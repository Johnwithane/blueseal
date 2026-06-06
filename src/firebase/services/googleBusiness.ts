// Client wrappers around the Google Business Profile callables. Components go
// through here (per CLAUDE.md service pattern) rather than calling httpsCallable
// directly, so callable names + response shapes stay in one place.

import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { GoogleReviewsSnapshot, TradespersonDoc } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

// Returns the Google OAuth consent URL. The caller navigates the browser to it
// (full-page, like the Stripe onboarding link) — Google redirects back to the
// googleOAuthCallback function, which lands the user on /account?tab=tradesperson.
export async function startGoogleBusinessConnect(): Promise<{ url: string }> {
  const callable = httpsCallable<undefined, { url: string }>(
    functions,
    "startGoogleBusinessConnect",
  );
  const { data } = await callable();
  return data;
}

export interface GoogleSyncResult {
  connected: boolean;
  rating: number | null;
  reviewCount: number;
  error: string | null;
}

// Manual "Sync now". The daily scheduled job keeps reviews fresh automatically.
export async function syncGoogleReviews(): Promise<GoogleSyncResult> {
  const callable = httpsCallable<undefined, GoogleSyncResult>(functions, "syncGoogleReviews");
  const { data } = await callable();
  return data;
}

export async function disconnectGoogleBusiness(): Promise<{ ok: true }> {
  const callable = httpsCallable<undefined, { ok: true }>(
    functions,
    "disconnectGoogleBusiness",
  );
  const { data } = await callable();
  return data;
}

// Live subscription to the googleReviews slice of the tradesperson doc, so the
// account panel reflects connect / sync / disconnect without a manual refetch.
export function subscribeGoogleReviews(
  uid: string,
  cb: (snapshot: GoogleReviewsSnapshot | null) => void,
): () => void {
  const ref = doc(db, "tradespeople", uid).withConverter(typedConverter<TradespersonDoc>());
  return onSnapshot(ref, (snap) => {
    cb(snap.exists() ? (snap.data().googleReviews ?? null) : null);
  });
}
