// Thin fetch wrappers over Google's OAuth token endpoint + the Business Profile
// APIs. No `googleapis` SDK dependency — the surface we touch is tiny (token
// exchange/refresh, list accounts, list locations, list reviews), so raw fetch
// keeps the function bundle lean and the calls obvious.
//
// Reviews still live on the LEGACY v4 endpoint (mybusiness.googleapis.com/v4) —
// Google never migrated them to the v1 Business Profile APIs. Accounts +
// locations come from the v1 management APIs. See:
//   https://developers.google.com/my-business/content/review-data

import { logger } from "firebase-functions/v2";
import {
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  clientId,
  clientSecret,
  redirectUri,
} from "./config";

const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS_API = "https://mybusiness.googleapis.com/v4";

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null; // only returned on the first consent
  expiresInSec: number;
}

export interface GoogleLocation {
  // v4 reviews need the numeric account + location ids; the v1 APIs return
  // resource names ("accounts/123", "locations/456") that we split.
  accountId: string;
  locationId: string;
  title: string;
  mapsUri: string | null;
  newReviewUri: string | null;
}

export interface GoogleReviewRaw {
  reviewId: string;
  authorName: string;
  authorPhotoUrl: string | null;
  rating: number; // 1-5
  comment: string;
  createTime: string; // ISO
}

export interface GoogleReviewsResult {
  rating: number | null; // averageRating across ALL reviews
  reviewCount: number; // totalReviewCount across ALL reviews
  reviews: GoogleReviewRaw[]; // most-recent slice (caller caps the count)
}

async function postForm(url: string, params: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

// Exchange the one-time authorization code (from the OAuth redirect) for an
// access token + a long-lived refresh token. The refresh token only comes back
// when the consent screen was requested with access_type=offline & prompt=consent.
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const res = await postForm(GOOGLE_TOKEN_ENDPOINT, {
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  if (!res.ok) {
    throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresInSec: json.expires_in,
  };
}

// Trade a stored refresh token for a fresh, short-lived access token. Called on
// every sync — access tokens expire in ~1h, refresh tokens persist.
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await postForm(GOOGLE_TOKEN_ENDPOINT, {
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "refresh_token",
  });
  if (!res.ok) {
    throw new Error(`token refresh failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

// Best-effort revoke on disconnect. Failures are logged, not thrown — the
// caller still tears down local state regardless.
export async function revokeToken(refreshToken: string): Promise<void> {
  try {
    await postForm(GOOGLE_REVOKE_ENDPOINT, { token: refreshToken });
  } catch (err) {
    logger.warn("google.revokeToken failed", { err });
  }
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}

const idFromName = (name: string): string => name.split("/").pop() ?? "";

// List the locations the authenticated merchant manages, flattened across all
// their accounts. Most tradies have exactly one; we connect the first by
// default and store its ids. (A future enhancement could let them pick.)
export async function listManagedLocations(accessToken: string): Promise<GoogleLocation[]> {
  const accountsRes = await getJson<{ accounts?: { name: string }[] }>(
    `${ACCOUNTS_API}/accounts`,
    accessToken,
  );
  const accounts = accountsRes.accounts ?? [];
  const out: GoogleLocation[] = [];
  for (const account of accounts) {
    const accountId = idFromName(account.name);
    const readMask = "name,title,metadata";
    const locRes = await getJson<{
      locations?: { name: string; title?: string; metadata?: { mapsUri?: string; newReviewUri?: string } }[];
    }>(`${INFO_API}/${account.name}/locations?readMask=${readMask}&pageSize=100`, accessToken);
    for (const loc of locRes.locations ?? []) {
      out.push({
        accountId,
        locationId: idFromName(loc.name),
        title: loc.title ?? "",
        mapsUri: loc.metadata?.mapsUri ?? null,
        newReviewUri: loc.metadata?.newReviewUri ?? null,
      });
    }
  }
  return out;
}

const STAR_TO_NUMBER: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

// Fetch the first page of reviews (newest first) plus the aggregate rating +
// total count. One page is enough — we only cache a handful for display and the
// average/count are page-independent fields on the response.
export async function listReviews(
  accessToken: string,
  accountId: string,
  locationId: string,
  pageSize: number,
): Promise<GoogleReviewsResult> {
  const url =
    `${REVIEWS_API}/accounts/${accountId}/locations/${locationId}/reviews` +
    `?orderBy=updateTime%20desc&pageSize=${pageSize}`;
  const json = await getJson<{
    reviews?: {
      reviewId: string;
      reviewer?: { displayName?: string; profilePhotoUrl?: string };
      starRating?: string;
      comment?: string;
      createTime?: string;
    }[];
    averageRating?: number;
    totalReviewCount?: number;
  }>(url, accessToken);

  const reviews: GoogleReviewRaw[] = (json.reviews ?? []).map((r) => ({
    reviewId: r.reviewId,
    authorName: r.reviewer?.displayName?.trim() || "A Google user",
    authorPhotoUrl: r.reviewer?.profilePhotoUrl ?? null,
    rating: STAR_TO_NUMBER[r.starRating ?? ""] ?? 0,
    comment: r.comment?.trim() ?? "",
    createTime: r.createTime ?? "",
  }));

  return {
    rating: typeof json.averageRating === "number" ? json.averageRating : null,
    reviewCount: typeof json.totalReviewCount === "number" ? json.totalReviewCount : 0,
    reviews,
  };
}
