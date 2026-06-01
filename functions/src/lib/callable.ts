import type { CallableOptions } from "firebase-functions/v2/https";

/**
 * Centralized options for every onCall callable.
 *
 * App Check enforcement is driven by the `ENFORCE_APP_CHECK` env var rather
 * than hard-coded per callable, so it can be turned on across the whole API in
 * one place once (a) a reCAPTCHA Enterprise key is provisioned and (b) the
 * client-side App Check init ships (see src/firebase/config.ts). Flipping it on
 * before the client init is live would reject every call, so the two must be
 * coordinated — hence the single switch.
 *
 * Defaults to OFF: a missing or mistyped env var must never silently break
 * every callable in prod. Set `ENFORCE_APP_CHECK=true` in the functions
 * runtime config to enforce.
 */
export const APP_CHECK_ENFORCED = process.env.ENFORCE_APP_CHECK === "true";

export const CALLABLE_OPTS: CallableOptions = {
  enforceAppCheck: APP_CHECK_ENFORCED,
};
