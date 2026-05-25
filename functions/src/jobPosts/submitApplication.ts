import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRoleOrAdmin } from "../lib/auth";
import { requireVisibleTradie, rateLimitKey } from "./helpers";
import { notify } from "../lib/notify";

const Input = z.object({
  postId: z.string().min(1).max(128),
  message: z.string().trim().min(20).max(2000),
  proposedPrice: z.object({
    type: z.enum(["fixed", "hourly"]),
    amount: z.number().int().min(500).max(10_000_000),
    notes: z.string().trim().max(500).optional(),
  }),
  proposedStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

const DAILY_APPLICATION_CAP = 10;

export const submitApplication = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRoleOrAdmin(req, "tradesperson");
  // Admins still need a tradesperson doc with isVisible:true to apply —
  // they don't get a free pass on the verified-tradie contract.
  await requireVisibleTradie(uid);

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { postId, message, proposedPrice, proposedStartDate } = parsed.data;
  const ctx = { fn: "submitApplication", uid, postId };

  const postRef = db.doc(`jobPosts/${postId}`);
  const appRef = postRef.collection("applications").doc(uid);
  const metaRef = postRef.collection("private").doc("meta");
  const rateRef = db.doc(`rateLimits/${rateLimitKey(uid, "applyToPost")}`);

  try {
    await db.runTransaction(async (tx) => {
      const [postSnap, appSnap, rateSnap] = await Promise.all([
        tx.get(postRef),
        tx.get(appRef),
        tx.get(rateRef),
      ]);
      if (!postSnap.exists) throw new HttpsError("not-found", "Job post not found.");
      const post = postSnap.data() as {
        status: string;
        clientId: string;
        expiresAt?: Timestamp;
      };
      if (post.status !== "open") {
        throw new HttpsError("failed-precondition", "This job post is no longer open.");
      }
      if (post.expiresAt && post.expiresAt.toMillis() < Date.now()) {
        throw new HttpsError("failed-precondition", "This job post has expired.");
      }
      if (post.clientId === uid) {
        throw new HttpsError("permission-denied", "You can't apply to your own post.");
      }
      if (appSnap.exists) {
        throw new HttpsError("already-exists", "You've already applied to this job.");
      }

      const rateCount = (rateSnap.data() as { count?: number } | undefined)?.count ?? 0;
      if (rateCount >= DAILY_APPLICATION_CAP) {
        throw new HttpsError(
          "resource-exhausted",
          `Daily application limit reached (${DAILY_APPLICATION_CAP}). Try again tomorrow.`,
        );
      }

      tx.set(appRef, {
        tradespersonId: uid,
        postId,
        clientId: post.clientId,
        status: "pending",
        message,
        proposedPrice,
        proposedStartDate: proposedStartDate
          ? Timestamp.fromDate(new Date(`${proposedStartDate}T00:00:00Z`))
          : null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        metaRef,
        { applicationCount: FieldValue.increment(1) },
        { merge: true },
      );
      tx.set(
        rateRef,
        {
          uid,
          action: "applyToPost",
          count: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    // Notify the client outside the transaction. onApplicationCreated trigger
    // also handles this — keeping it here means we don't drop notifications
    // on a transient trigger failure. Idempotent at the UI layer is fine for
    // a brief duplicate.
    const postSnap = await postRef.get();
    const post = postSnap.data() as { clientId: string; title: string };
    await notify({
      userId: post.clientId,
      type: "new_application",
      title: "New tradesperson applied",
      body: `Someone applied to your job "${post.title}".`,
      link: `/jobs/posted/${postId}`,
      actorUid: uid,
      recipientRole: "client",
      priority: "high",
    });

    logger.info("submitApplication success", ctx);
    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("submitApplication failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't submit application.");
  }
});
