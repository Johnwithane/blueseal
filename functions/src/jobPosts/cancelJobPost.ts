import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

const Input = z.object({
  postId: z.string().min(1).max(128),
  reason: z.string().trim().max(500).optional(),
});

export const cancelJobPost = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { postId, reason } = parsed.data;
  const ctx = { fn: "cancelJobPost", uid, postId };

  const postRef = db.doc(`jobPosts/${postId}`);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(postRef);
      if (!snap.exists) throw new HttpsError("not-found", "Post not found.");
      const post = snap.data() as { clientId: string; status: string };
      if (post.clientId !== uid) {
        throw new HttpsError("permission-denied", "Not your post.");
      }
      if (post.status !== "open") {
        throw new HttpsError("failed-precondition", `Post is ${post.status}, not open.`);
      }
      tx.update(postRef, {
        status: "cancelled",
        closedAt: FieldValue.serverTimestamp(),
      });
    });

    await logAdminAction({
      actorUid: uid,
      action: "cancelJobPost",
      targetType: "jobPost",
      targetId: postId,
      reason: reason ?? null,
    });

    logger.info("cancelJobPost success", ctx);
    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("cancelJobPost failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't cancel post.");
  }
});
