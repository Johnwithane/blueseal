// HTTP endpoint Google redirects the browser to after the tradesperson grants
// (or denies) consent. Unauthenticated by nature — the only thing binding the
// redirect to a tradie is our HMAC-signed `state`, which we verify before
// touching anything. On success it stores the connection + runs an initial sync,
// then bounces the user back into the app's Tradesperson tab.
//
// The redirect_uri registered on the OAuth client MUST equal GOOGLE_OAUTH_REDIRECT_URI
// and point at this function's URL (or a hosting rewrite to it). See HUMANTASKS.md.

import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { GOOGLE_SECRETS, isConfigured, verifyOAuthState } from "./config";
import { exchangeCodeForTokens, listManagedLocations } from "./api";
import { saveConnection } from "./sync";

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://blueseal.app").replace(/\/$/, "");
}

// All exits land the user on the Tradesperson tab with a ?google=<status> hint
// the AccountView reads to show the right toast.
function back(status: string): string {
  return `${appBaseUrl()}/account?tab=tradesperson&google=${status}`;
}

export const googleOAuthCallback = onRequest({ secrets: GOOGLE_SECRETS }, async (req, res) => {
  const error = typeof req.query.error === "string" ? req.query.error : null;
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;

  // User clicked "Cancel" on Google's consent screen.
  if (error) {
    res.redirect(back("denied"));
    return;
  }

  // Config check first: verifyOAuthState needs the encryption key, so guard
  // before touching it (an unconfigured deploy should redirect cleanly, not 500).
  if (!isConfigured()) {
    res.redirect(back("error"));
    return;
  }

  let uid: string | null = null;
  try {
    uid = state ? verifyOAuthState(state) : null;
    if (!uid || !code) {
      logger.warn("googleOAuthCallback: invalid state or missing code");
      res.redirect(back("error"));
      return;
    }
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refreshToken) {
      // Shouldn't happen with prompt=consent, but guard: without a refresh
      // token we can't sync later, so treat as a failure rather than half-connect.
      logger.warn("googleOAuthCallback: no refresh token returned", { uid });
      res.redirect(back("error"));
      return;
    }
    const locations = await listManagedLocations(tokens.accessToken);
    if (locations.length === 0) {
      res.redirect(back("nolocation"));
      return;
    }
    // Connect the first managed location. Most tradies have exactly one.
    await saveConnection(uid, tokens.refreshToken, locations[0]);
    logger.info("googleOAuthCallback: connected", { uid, locationId: locations[0].locationId });
    res.redirect(back("connected"));
  } catch (err) {
    logger.error("googleOAuthCallback failed", { uid, err: (err as Error)?.message });
    res.redirect(back("error"));
  }
});
