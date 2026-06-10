import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRoleOrAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { notify } from "../lib/notify";
import { postApplicationSystemMessage } from "./applicationThread";

// Client dismisses one applicant's quote with a reason. The card leaves the
// client's active list (status flips to "declined") and the tradesperson is
// told why so they can revise + re-apply. Mirrors clientDeclineQuote on the
// direct-request side. `declined` is distinct from the system-set `rejected`
// (which acceptApplicationQuote sets on the OTHER applicants when one is chosen).
const Input = z.object({
  postId: z.string().min(1).max(128),
  applicationId: z.string().min(1).max(128),
  reason: z.string().trim().min(1).max(1000),
});

interface PostData {
  clientId: string;
  title: string;
}

interface ApplicationData {
  tradespersonId: string;
  status: string;
}

export const declineApplication = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRoleOrAdmin(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { postId, applicationId, reason } = parsed.data;
  const ctx = { fn: "declineApplication", uid, postId, applicationId };

  const postRef = db.doc(`jobPosts/${postId}`);
  const appRef = postRef.collection("applications").doc(applicationId);
  const metaRef = postRef.collection("private").doc("meta");

  let result: { tradespersonId: string; title: string };
  try {
    result = await db.runTransaction(async (tx) => {
      const [postSnap, appSnap] = await Promise.all([tx.get(postRef), tx.get(appRef)]);
      if (!postSnap.exists) throw new HttpsError("not-found", "Job post not found.");
      const post = postSnap.data() as PostData;
      if (post.clientId !== uid) throw new HttpsError("permission-denied", "Not your post.");
      if (!appSnap.exists) throw new HttpsError("not-found", "Application not found.");
      const app = appSnap.data() as ApplicationData;
      if (app.status !== "pending") {
        throw new HttpsError("failed-precondition", `Application is ${app.status}, not pending.`);
      }

      tx.update(appRef, {
        status: "declined",
        declinedReason: reason,
        declinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      // applicationCount tracks ACTIVE applicants (withdraw decrements it too),
      // and a declined card leaves the client's active list.
      tx.set(metaRef, { applicationCount: FieldValue.increment(-1) }, { merge: true });

      return { tradespersonId: app.tradespersonId, title: post.title };
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("declineApplication failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't decline this applicant.");
  }

  // Post-commit (best-effort): system line in the thread + notify the tradie.
  await postApplicationSystemMessage(postId, applicationId, `Client declined this quote — "${reason}"`);
  await notify({
    userId: result.tradespersonId,
    type: "application_declined",
    title: "Your quote was declined",
    body: reason.length > 200 ? reason.slice(0, 197) + "..." : reason,
    link: `/jobs/posted/${postId}`,
    actorUid: uid,
    recipientRole: "tradesperson",
    priority: "high",
  });
  await logAdminAction({
    actorUid: uid,
    action: "declineApplication",
    targetType: "jobPost",
    targetId: postId,
    reason,
    metadata: { applicationId },
  });

  logger.info("declineApplication success", ctx);
  return { ok: true };
});
