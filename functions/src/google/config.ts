// Google Business Profile integration — secrets, config gate, and crypto.
//
// Mirrors the Stripe pattern (functions/src/payments/stripeClient.ts): secrets
// are declared once here and re-exported so each function lists them in its
// `secrets: [...]` option. Everything degrades gracefully when unset — the
// callables throw a "not configured" error and `isConfigured()` returns false,
// exactly like the Stripe + prospect-outreach flows. See HUMANTASKS.md →
// "Google Business reviews integration" for the setup that flips it live.
//
// Why secrets vs plain env:
//   - GOOGLE_OAUTH_CLIENT_SECRET — the OAuth app secret. Sensitive → defineSecret.
//   - GOOGLE_TOKEN_ENC_KEY       — AES key wrapping each tradie's refresh token
//                                  at rest. Sensitive → defineSecret.
//   - GOOGLE_OAUTH_CLIENT_ID     — public half of the OAuth app; plain env.
//   - GOOGLE_OAUTH_REDIRECT_URI  — must EXACTLY match the value registered on
//                                  the OAuth client in Google Cloud; plain env.

import { defineSecret } from "firebase-functions/params";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");
export const GOOGLE_TOKEN_ENC_KEY = defineSecret("GOOGLE_TOKEN_ENC_KEY");

// List for each function's `secrets: [...]` option. Binding a secret to a
// function is what makes it resolvable (and present in process.env) at runtime.
export const GOOGLE_SECRETS = [GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_TOKEN_ENC_KEY];

// OAuth scope for reading the merchant's own reviews + locations. business.manage
// is the single scope that grants the Business Profile APIs (account/location
// management) plus the legacy v4 reviews endpoint.
export const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/business.manage";

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

// How many recent reviews to cache on the public snapshot for display. The
// aggregate rating + total count reflect ALL reviews; this is just the list we
// render under the headline. Kept small — the profile links out to Google for
// the full set.
export const MAX_SNAPSHOT_REVIEWS = 6;

export function clientId(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
}

export function redirectUri(): string {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "";
}

export function clientSecret(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
}

// All four pieces must be present for the flow to work. Secrets are injected
// into process.env when bound to the function, so a single env check covers
// both the secrets and the plain config — no `.value()` calls that throw when
// unbound (which is the whole point of degrading gracefully).
export function isConfigured(): boolean {
  return Boolean(
    clientId() && clientSecret() && redirectUri() && process.env.GOOGLE_TOKEN_ENC_KEY,
  );
}

// 32-byte AES key, provided base64-encoded. Throws if malformed so a
// misconfigured key fails loudly at use time rather than writing garbage.
function encKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENC_KEY ?? "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENC_KEY must be 32 bytes, base64-encoded");
  }
  return key;
}

// AES-256-GCM. Output is `iv.tag.ciphertext`, each base64url — self-describing
// so decrypt needs no side channel. Used to wrap the long-lived refresh token
// before it touches Firestore.
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptToken(encoded: string): string {
  const [ivB64, tagB64, ctB64] = encoded.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("malformed encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

// OAuth `state`: the callback is unauthenticated (Google redirects the browser),
// so state is the ONLY thing binding the redirect back to the tradie who
// started the flow. It's an HMAC-signed, time-boxed token — an attacker can't
// forge one for another uid without the key. Signed with the same enc key
// (different construction, so no cross-use risk).
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function stateHmac(payloadB64: string): string {
  return createHmac("sha256", encKey()).update(payloadB64).digest("base64url");
}

export function signOAuthState(uid: string): string {
  const payload = { uid, exp: Date.now() + STATE_TTL_MS, n: randomBytes(8).toString("base64url") };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${stateHmac(payloadB64)}`;
}

// Returns the uid if the state is authentic and unexpired, else null.
export function verifyOAuthState(state: string): string | null {
  const [payloadB64, sig] = (state ?? "").split(".");
  if (!payloadB64 || !sig) return null;
  const expected = stateHmac(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      uid?: unknown;
      exp?: unknown;
    };
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
