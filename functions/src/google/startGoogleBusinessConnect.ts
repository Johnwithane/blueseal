// Callable: returns the Google OAuth consent URL for the calling tradesperson
// to connect their Google Business Profile. The browser navigates to this URL;
// Google redirects back to `googleOAuthCallback` with an auth code + our signed
// `state` (which binds the redirect to this uid).

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { requireRole } from "../lib/auth";
import {
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_OAUTH_SCOPE,
  GOOGLE_SECRETS,
  clientId,
  isConfigured,
  redirectUri,
  signOAuthState,
} from "./config";

export const startGoogleBusinessConnect = onCall(
  { ...CALLABLE_OPTS, secrets: GOOGLE_SECRETS },
  async (req) => {
    const uid = requireRole(req, "tradesperson");
    if (!isConfigured()) {
      throw new HttpsError(
        "failed-precondition",
        "Google Business integration isn't configured yet.",
      );
    }
    // access_type=offline + prompt=consent guarantees a refresh token comes
    // back even if the tradesperson previously connected — we need it to sync
    // on a schedule without them present.
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: GOOGLE_OAUTH_SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: signOAuthState(uid),
    });
    return { url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}` };
  },
);
