// Callable: disconnect the tradesperson's Google Business Profile. Revokes the
// token with Google, deletes the server-only credential doc, and clears the
// public review snapshot so the profile stops showing Google reviews at once.

import { onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { requireRole } from "../lib/auth";
import { GOOGLE_SECRETS } from "./config";
import { disconnectTradie } from "./sync";

export const disconnectGoogleBusiness = onCall(
  { ...CALLABLE_OPTS, secrets: GOOGLE_SECRETS },
  async (req) => {
    const uid = requireRole(req, "tradesperson");
    await disconnectTradie(uid);
    return { ok: true as const };
  },
);
