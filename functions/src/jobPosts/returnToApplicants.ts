import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { notify } from "../lib/notify";

const Input = z.object({ postId: z.string().min(1).max(128) });

// Client escape hatch after acceptApplication but before they've completed
// the intake form (i.e. job status is still 'accepted'). Cancels the job,
// flips the post back to open, returns the previously-selected applicant
// to pending. Rejected applicants stay rejected to avoid re-spamming them.
export const returnToApplicants = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { postId } = parsed.data;
  const ctx = { fn: "returnToApplicants", uid, postId };

  const postRef = db.doc(`jobPosts/${postId}`);
  const metaRef = postRef.collection("private").doc("meta");

  try {
    const result = await db.runTransaction(async (tx) => {
      const [postSnap, metaSnap] = await Promise.all([tx.get(postRef), tx.get(metaRef)]);
      if (!postSnap.exists) throw new HttpsError("not-found", "Post not found.");
      const post = postSnap.data() as {
        clientId: string;
        status: string;
        convertedJobId: string | null;
      };
      if (post.clientId !== uid) {
        throw new HttpsError("permission-denied", "Not your post.");
      }
      if (post.status !== "closed" || !post.convertedJobId) {
        throw new HttpsError(
          "failed-precondition",
          "Post is not in a 'closed via accept' state.",
        );
      }
      const meta = metaSnap.data() as { selectedApplicantId: string | null };
      const selectedId = meta?.selectedApplicantId ?? null;

      const jobRef = db.doc(`jobs/${post.convertedJobId}`);
      const jobSnap = await tx.get(jobRef);
      if (!jobSnap.exists) {
        throw new HttpsError("internal", "Converted job missing.");
      }
      const job = jobSnap.data() as { status: string };
      if (job.status !== "accepted") {
        throw new HttpsError(
          "failed-precondition",
          "The brief has already been completed — you can't return to applicants now.",
        );
      }

      tx.update(jobRef, {
        status: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledReason: "client returned to applicants",
        // Sentinel — onJobCancelled (Phase 4 trigger) skips notifying when
        // cancelledBy === "system" because returnToApplicants already fires
        // the application_returned notification a few lines below.
        cancelledBy: "system",
      });
      tx.update(postRef, {
        status: "open",
        closedAt: null,
        acceptedAt: null,
        convertedJobId: null,
      });
      tx.set(
        metaRef,
        { selectedApplicantId: null },
        { merge: true },
      );

      if (selectedId) {
        const selectedAppRef = postRef.collection("applications").doc(selectedId);
        tx.update(selectedAppRef, {
          status: "pending",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return { selectedId, postTitle: (postSnap.data() as { title: string }).title };
    });

    if (result.selectedId) {
      await notify({
        userId: result.selectedId,
        type: "application_returned",
        title: "Client reopened the job",
        body: `The client returned to applicants for "${result.postTitle}". Your application is back to pending.`,
        link: `/jobs/posted/${postId}`,
        actorUid: uid,
      });
    }

    await logAdminAction({
      actorUid: uid,
      action: "returnToApplicants",
      targetType: "jobPost",
      targetId: postId,
    });

    logger.info("returnToApplicants success", ctx);
    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("returnToApplicants failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't return to applicants.");
  }
});
