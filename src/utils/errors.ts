/**
 * Map Firebase / network errors to user-friendly copy, hiding implementation
 * details. Keep wrong-password and user-not-found indistinguishable so we
 * don't leak account-existence to brute-force scanners.
 */
const FIREBASE_AUTH_MAP: Record<string, string> = {
  "auth/invalid-email": "That email doesn't look right.",
  "auth/email-already-in-use":
    "That email is already in use. Try signing in instead.",
  "auth/user-not-found": "Email or password is incorrect.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/weak-password": "That password is too weak. Use 8+ characters.",
  "auth/too-many-requests":
    "Too many attempts. Try again in a few minutes, or reset your password.",
  "auth/popup-closed-by-user": "Sign-in window was closed. Please try again.",
  "auth/popup-blocked":
    "Your browser blocked the sign-in popup. Allow popups and retry.",
  "auth/network-request-failed":
    "Network problem. Check your connection and try again.",
  "auth/user-disabled":
    "This account has been disabled. Contact support if you believe this is an error.",
  "auth/requires-recent-login":
    "Please sign out and back in, then try again.",
};

const FUNCTIONS_CODE_MAP: Record<string, string> = {
  unauthenticated: "Please sign in and try again.",
  "permission-denied": "You don't have permission to do that.",
  "not-found": "We couldn't find what you were looking for.",
  "failed-precondition": "That can't be done right now. Check the page state.",
  unavailable: "Service is unavailable. Please try again shortly.",
  internal: "Something went wrong on our end. Please try again.",
  "deadline-exceeded": "That took too long. Please try again.",
  "resource-exhausted": "You've hit a usage limit. Please try again later.",
};

interface FirebaseLikeError {
  code?: string;
  message?: string;
}

// Stable token the server leads a Blue Seal Pro paywall message with (a callable
// HttpsError can't carry a custom code, so the token rides in the message). Keep
// in sync with functions/src/lib/{entitlements,subscription}.ts.
const PAYWALL_TOKEN = "BLUESEAL_PRO_REQUIRED";

/** True when an error is the server's Blue Seal Pro paywall signal. */
export function isPaywallError(e: unknown): boolean {
  const msg = (e as FirebaseLikeError | null)?.message;
  return typeof msg === "string" && msg.includes(PAYWALL_TOKEN);
}

/**
 * The human half of a paywall error — everything after the `BLUESEAL_PRO_REQUIRED:`
 * token (e.g. "The AI assistant is part of Blue Seal Pro. Start a free trial to
 * use it.") — or null when `e` isn't a paywall error. Lets the upgrade dialog
 * reuse the server's feature-specific copy.
 */
export function paywallMessage(e: unknown): string | null {
  const msg = (e as FirebaseLikeError | null)?.message;
  if (typeof msg !== "string" || !msg.includes(PAYWALL_TOKEN)) return null;
  const after = msg.split(PAYWALL_TOKEN)[1] ?? "";
  return after.replace(/^[:\s]+/, "").trim() || null;
}

export function humanizeError(e: unknown): string {
  if (e == null) return "Something went wrong. Please try again.";
  // Paywall errors should normally be intercepted upstream (→ upgrade dialog),
  // but if one reaches a toast, show the clean copy without the raw token.
  const paywall = paywallMessage(e);
  if (paywall) return paywall;
  const err = e as FirebaseLikeError;
  const code = typeof err.code === "string" ? err.code : "";
  const rawMsg = (err.message ?? "").replace(/^Firebase:\s*/, "").trim();
  // Auth errors get the canned copy — Firebase's own messages leak internals
  // and security-sensitive distinctions (e.g. wrong-password vs user-not-found).
  if (code && FIREBASE_AUTH_MAP[code]) return FIREBASE_AUTH_MAP[code];
  const tail = code.split("/").pop() ?? "";
  if (tail && FIREBASE_AUTH_MAP[`auth/${tail}`]) return FIREBASE_AUTH_MAP[`auth/${tail}`];
  // Callable functions errors (`functions/<code>`) author their own message
  // — prefer it over the generic per-code copy so subscription gates, quota
  // hints, etc. reach the user instead of a flat "permission denied".
  if (code.startsWith("functions/")) {
    if (rawMsg && rawMsg.length < 200) return rawMsg;
    if (FUNCTIONS_CODE_MAP[tail]) return FUNCTIONS_CODE_MAP[tail];
  }
  if (code && FUNCTIONS_CODE_MAP[code]) return FUNCTIONS_CODE_MAP[code];
  if (tail && FUNCTIONS_CODE_MAP[tail]) return FUNCTIONS_CODE_MAP[tail];
  if (rawMsg && rawMsg.length < 200) return rawMsg;
  return "Something went wrong. Please try again.";
}
