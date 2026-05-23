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

export function humanizeError(e: unknown): string {
  if (e == null) return "Something went wrong. Please try again.";
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
