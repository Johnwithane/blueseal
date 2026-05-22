import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, GeoPoint, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db, storage } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { notify } from "../lib/notify";

const Input = z.object({
  postId: z.string().min(1).max(128),
  applicationId: z.string().min(1).max(128),
});

interface PostDoc {
  clientId: string;
  status: string;
  trade: string;
  title: string;
  description: string;
  photos: string[];
  urgency: "flexible" | "this_week" | "urgent";
  preferredDateWindow: { start: Timestamp | null; end: Timestamp | null };
}

interface MetaDoc {
  addressPrivate: {
    line1: string;
    fullPostal: string;
    geo: GeoPoint;
  };
  selectedApplicantId: string | null;
}

interface ApplicationDoc {
  tradespersonId: string;
  status: string;
}

interface TradespersonDoc {
  isVisible?: boolean;
}

interface ChatPayload {
  jobId: string;
  clientId: string;
  tradespersonId: string;
  lastMessageAt: null;
  lastMessagePreview: string;
  unreadCounts: Record<string, number>;
}

interface JobPayload {
  clientId: string;
  tradespersonId: string;
  status: "accepted";
  trade: string;
  title: string;
  description: string;
  intakeFormData: Record<string, never>;
  intakePhotos: string[];
  address: {
    line1: string;
    city: string;
    region: string;
    postalCode: string;
    geo: GeoPoint;
  };
  preferredDateWindow: { start: Timestamp | null; end: Timestamp | null };
  urgency: "flexible" | "this_week" | "urgent";
  scheduledStart: null;
  scheduledEnd: null;
  createdAt: FirebaseFirestore.FieldValue;
  completedAt: null;
  cancelledAt: null;
  cancelledReason: null;
  chatId: string;
  privateNotes: string;
  sourcePostId: string;
}

export const acceptApplication = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { postId, applicationId } = parsed.data;
  const ctx = { fn: "acceptApplication", uid, postId, applicationId };

  const postRef = db.doc(`jobPosts/${postId}`);
  const metaRef = postRef.collection("private").doc("meta");
  const appRef = postRef.collection("applications").doc(applicationId);

  // Pre-allocate the job + chat ids so the transaction is deterministic on
  // retry — Firestore retries pick the same destination docs.
  const jobRef = db.collection("jobs").doc();
  const chatRef = db.collection("chats").doc();

  let postSnapshot: PostDoc | null = null;

  try {
    await db.runTransaction(async (tx) => {
      const [postSnap, metaSnap, appSnap] = await Promise.all([
        tx.get(postRef),
        tx.get(metaRef),
        tx.get(appRef),
      ]);
      if (!postSnap.exists) throw new HttpsError("not-found", "Job post not found.");
      const post = postSnap.data() as PostDoc;
      if (post.clientId !== uid) {
        throw new HttpsError("permission-denied", "Not your post.");
      }
      if (post.status !== "open") {
        throw new HttpsError("failed-precondition", "Post is not open.");
      }
      if (!metaSnap.exists) {
        throw new HttpsError("internal", "Post meta missing — refusing to accept.");
      }
      const meta = metaSnap.data() as MetaDoc;
      if (meta.selectedApplicantId) {
        throw new HttpsError("failed-precondition", "An applicant has already been selected.");
      }
      if (!appSnap.exists) throw new HttpsError("not-found", "Application not found.");
      const app = appSnap.data() as ApplicationDoc;
      if (app.status !== "pending") {
        throw new HttpsError(
          "failed-precondition",
          `Application is ${app.status}, not pending.`,
        );
      }

      // Tradie still has to be approved at acceptance time.
      const tradieSnap = await tx.get(db.doc(`tradespeople/${app.tradespersonId}`));
      const tradie = tradieSnap.data() as TradespersonDoc | undefined;
      if (!tradie?.isVisible) {
        throw new HttpsError(
          "failed-precondition",
          "This tradesperson is no longer available. Their account was suspended or de-listed.",
        );
      }

      postSnapshot = post;

      // The address postal code is the full postal stored in /private/meta.
      // The city + region we pull from the parent doc's addressPublic so we
      // don't depend on a separate read.
      const postPublic = post as PostDoc & {
        addressPublic: { city: string; region: string };
      };

      const jobPayload: JobPayload = {
        clientId: uid,
        tradespersonId: app.tradespersonId,
        status: "accepted",
        trade: post.trade,
        title: post.title,
        description: post.description,
        intakeFormData: {},
        intakePhotos: [], // populated post-commit after storage copy
        address: {
          line1: meta.addressPrivate.line1,
          city: postPublic.addressPublic.city,
          region: postPublic.addressPublic.region,
          postalCode: meta.addressPrivate.fullPostal,
          geo: meta.addressPrivate.geo,
        },
        preferredDateWindow: post.preferredDateWindow,
        urgency: post.urgency,
        scheduledStart: null,
        scheduledEnd: null,
        createdAt: FieldValue.serverTimestamp(),
        completedAt: null,
        cancelledAt: null,
        cancelledReason: null,
        chatId: chatRef.id,
        privateNotes: "",
        sourcePostId: postId,
      };
      tx.set(jobRef, jobPayload);

      const chatPayload: ChatPayload = {
        jobId: jobRef.id,
        clientId: uid,
        tradespersonId: app.tradespersonId,
        lastMessageAt: null,
        lastMessagePreview: "",
        unreadCounts: { [uid]: 0, [app.tradespersonId]: 0 },
      };
      tx.set(chatRef, chatPayload);

      tx.update(appRef, {
        status: "selected",
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(postRef, {
        status: "closed",
        closedAt: FieldValue.serverTimestamp(),
        acceptedAt: FieldValue.serverTimestamp(),
        convertedJobId: jobRef.id,
      });
      tx.set(
        metaRef,
        { selectedApplicantId: app.tradespersonId },
        { merge: true },
      );
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("acceptApplication txn failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't accept application.");
  }

  // Post-commit: copy photo blobs from jobPosts/{postId}/photos/* into the
  // new job's intake/. The post path remains readable for now (the storage
  // rules allow signed-in reads); the new job's path is party-scoped. If the
  // copy fails, the job exists but intakePhotos stays empty — the client
  // will see an "image missing" placeholder rather than the txn rolling
  // back.
  const post = postSnapshot as PostDoc | null;
  const newPaths: string[] = [];
  if (post && post.photos.length > 0) {
    try {
      const bucket = storage.bucket();
      for (const srcPath of post.photos) {
        const filename = srcPath.split("/").pop() || `${Date.now()}.webp`;
        const destPath = `jobs/${jobRef.id}/intake/${filename}`;
        await bucket.file(srcPath).copy(bucket.file(destPath));
        newPaths.push(destPath);
      }
      await jobRef.update({ intakePhotos: newPaths });
    } catch (err) {
      logger.error("acceptApplication photo copy failed", { ...ctx, err });
      // Non-fatal: continue, notifications still fire below.
    }
  }

  // Notify the selected tradie.
  if (post) {
    await notify({
      userId: (await appRef.get()).get("tradespersonId") as string,
      type: "application_accepted",
      title: "You were selected!",
      body: `The client chose you for "${post.title}". Open the job to introduce yourself.`,
      link: `/jobs/${jobRef.id}`,
      jobId: jobRef.id,
      actorUid: uid,
      priority: "high",
    });
  }

  await logAdminAction({
    actorUid: uid,
    action: "acceptApplication",
    targetType: "jobPost",
    targetId: postId,
    metadata: { jobId: jobRef.id, applicationId },
  });

  logger.info("acceptApplication success", { ...ctx, jobId: jobRef.id });
  return { jobId: jobRef.id, chatId: chatRef.id };
});
