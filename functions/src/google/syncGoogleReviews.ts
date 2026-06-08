// Callable: manual "Sync now" for the connected tradesperson. The daily
// scheduled job keeps reviews fresh automatically; this is the on-demand button
// in the account UI for when a tradie wants their latest Google review to show
// right away.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { requireRole } from "../lib/auth";
import { GOOGLE_SECRETS, isConfigured } from "./config";
import { syncReviewsForTradie } from "./sync";

export const syncGoogleReviews = onCall(
  { ...CALLABLE_OPTS, secrets: GOOGLE_SECRETS },
  async (req) => {
    const uid = requireRole(req, "tradesperson");
    if (!isConfigured()) {
      throw new HttpsError(
        "failed-precondition",
        "Google Business integration isn't configured yet.",
      );
    }
    const result = await syncReviewsForTradie(uid);
    if (!result.connected) {
      throw new HttpsError("failed-precondition", "No Google Business account is connected.");
    }
    if (result.error) {
      throw new HttpsError("unavailable", "Couldn't refresh from Google. Try again shortly.");
    }
    return result;
  },
);
