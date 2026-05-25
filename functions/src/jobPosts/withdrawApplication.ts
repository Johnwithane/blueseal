import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRoleOrAdmin } from "../lib/auth";

const Input = z.object({ postId: z.string().min(1).max(128) });

export const withdrawApplication = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRoleOrAdmin(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { postId } = parsed.data;
  const ctx = { fn: "withdrawApplication", uid, postId };

  const appRef = db.doc(`jobPosts/${postId}/applications/${uid}`);
  const metaRef = db.doc(`jobPosts/${postId}/private/meta`);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(appRef);
      if (!snap.exists) throw new HttpsError("not-found", "Application not found.");
      const data = snap.data() as { status: string };
      if (data.status !== "pending") {
        throw new HttpsError(
          "failed-precondition",
          "You can only withdraw an application that's still pending.",
        );
      }
      tx.update(appRef, {
        status: "withdrawn",
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        metaRef,
        { applicationCount: FieldValue.increment(-1) },
        { merge: true },
      );
    });
    logger.info("withdrawApplication success", ctx);
    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("withdrawApplication failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't withdraw application.");
  }
});
