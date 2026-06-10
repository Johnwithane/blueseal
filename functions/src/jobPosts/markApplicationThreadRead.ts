import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { applicationDocRef } from "./applicationThread";
import { db } from "../lib/admin";

// Clear the caller's own unread count on an application thread. Server-side
// because the application doc is callable-only-write (the client can't patch
// threadUnreadCounts directly — that would reopen the quote-tamper hole).
const Input = z.object({
  postId: z.string().min(1).max(128),
  applicationId: z.string().min(1).max(128),
});

interface ApplicationData {
  clientId: string;
  tradespersonId: string;
}

export const markApplicationThreadRead = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { postId, applicationId } = parsed.data;
  const appRef = applicationDocRef(postId, applicationId);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(appRef);
      if (!snap.exists) throw new HttpsError("not-found", "Application not found.");
      const app = snap.data() as ApplicationData;
      if (uid !== app.clientId && uid !== app.tradespersonId) {
        throw new HttpsError("permission-denied", "Not a participant in this application.");
      }
      tx.update(appRef, { [`threadUnreadCounts.${uid}`]: 0 });
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("markApplicationThreadRead failed", { fn: "markApplicationThreadRead", uid, postId, err });
    throw new HttpsError("internal", "Couldn't update the thread.");
  }
});
