import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, GeoPoint, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db, storage } from "../lib/admin";
import { requireRoleOrAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { postSystemMessage } from "../lib/chatSystemMessage";
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
  intakeFormData?: Record<string, unknown>;
  photos: string[];
  urgency: "flexible" | "this_week" | "urgent";
  preferredDateWindow: { start: Timestamp | null; end: Timestamp | null };
  addressPublic: { city: string; region: string };
}

interface MetaDoc {
  addressPrivate: { line1: string; fullPostal: string; geo: GeoPoint };
  selectedApplicantId: string | null;
}

interface QuoteData {
  lineItems: unknown[];
  subtotal: number;
  discount: unknown;
  discountAmount: number;
  taxTotal: number;
  total: number;
  upfrontFee?: { type: "fixed" | "percent"; bps?: number; amountCents: number } | null;
  estimatedHours: number | null;
  proposedStartDate?: Timestamp | null;
  estimatedDuration?: string;
  validUntil: Timestamp | null;
  terms: string;
  noteToClient: string;
}

interface ApplicationData {
  tradespersonId: string;
  status: string;
  quote?: QuoteData | null;
}

interface TradespersonData {
  isVisible?: boolean;
  displayName?: string | null;
  photoURL?: string | null;
  companyName?: string | null;
  nextQuoteNumber?: number;
  quotePrefix?: string;
}

interface UserDoc {
  displayName?: string | null;
  photoURL?: string | null;
}

/**
 * Bid-marketplace accept: the client accepts one applicant's full itemized
 * quote in a single action. Merges acceptApplication (create job + chat, close
 * post, copy photos) with clientAcceptQuote (materialize quotes/{jobId} as
 * "accepted", land the job in "in_progress" — or "awaiting_upfront_payment"
 * when the quote carried an upfront fee). Other pending applicants are rejected
 * + notified post-commit.
 *
 * Legacy applications (quote == null) are NOT accepted here — the client uses
 * the old acceptApplication ("Pick this tradesperson") path for those.
 */
export const acceptApplicationQuote = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRoleOrAdmin(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { postId, applicationId } = parsed.data;
  const ctx = { fn: "acceptApplicationQuote", uid, postId, applicationId };

  const postRef = db.doc(`jobPosts/${postId}`);
  const metaRef = postRef.collection("private").doc("meta");
  const appRef = postRef.collection("applications").doc(applicationId);

  // Pre-allocate destination ids so the transaction is deterministic on retry.
  const jobRef = db.collection("jobs").doc();
  const chatRef = db.collection("chats").doc();
  const quoteRef = db.doc(`quotes/${jobRef.id}`);

  let txnOut: {
    post: PostDoc;
    tradespersonId: string;
    quoteNumber: string;
    total: number;
    upfrontFeeCents: number;
  };

  try {
    txnOut = await db.runTransaction(async (tx) => {
      const [postSnap, metaSnap, appSnap] = await Promise.all([
        tx.get(postRef),
        tx.get(metaRef),
        tx.get(appRef),
      ]);
      if (!postSnap.exists) throw new HttpsError("not-found", "Job post not found.");
      const post = postSnap.data() as PostDoc;
      if (post.clientId !== uid) throw new HttpsError("permission-denied", "Not your post.");
      if (post.status !== "open") throw new HttpsError("failed-precondition", "Post is not open.");
      if (!metaSnap.exists) {
        throw new HttpsError("internal", "Post meta missing — refusing to accept.");
      }
      const meta = metaSnap.data() as MetaDoc;
      if (meta.selectedApplicantId) {
        throw new HttpsError("failed-precondition", "An applicant has already been selected.");
      }
      if (!appSnap.exists) throw new HttpsError("not-found", "Application not found.");
      const app = appSnap.data() as ApplicationData;
      if (app.status !== "pending") {
        throw new HttpsError("failed-precondition", `Application is ${app.status}, not pending.`);
      }
      const quote = app.quote;
      if (!quote || quote.total <= 0) {
        throw new HttpsError(
          "failed-precondition",
          "This applicant didn't submit a full quote — pick them with the standard flow instead.",
        );
      }

      // Tradie must still be approved/visible at acceptance time; also read both
      // user docs so we can denormalize the counterparty display fields onto the
      // job (rules block parties from reading each other's user doc).
      const [tradieSnap, clientUserSnap] = await Promise.all([
        tx.get(db.doc(`tradespeople/${app.tradespersonId}`)),
        tx.get(db.doc(`users/${uid}`)),
      ]);
      const tradie = tradieSnap.data() as TradespersonData | undefined;
      if (!tradie?.isVisible) {
        throw new HttpsError(
          "failed-precondition",
          "This tradesperson is no longer available. Their account was suspended or de-listed.",
        );
      }
      const clientUser = clientUserSnap.data() as UserDoc | undefined;

      // Assign the quote number from the tradie's running sequence.
      const seq = tradie.nextQuoteNumber ?? 1;
      const prefix = (tradie.quotePrefix ?? "Q").trim() || "Q";
      const year = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        year: "numeric",
      }).format(new Date());
      const quoteNumber = `${prefix}-${year}-${String(seq).padStart(4, "0")}`;

      const upfront = quote.upfrontFee ?? null;
      const requiresUpfront = upfront != null && upfront.amountCents > 0;
      const jobStatus = requiresUpfront ? "awaiting_upfront_payment" : "in_progress";

      tx.set(jobRef, {
        clientId: uid,
        tradespersonId: app.tradespersonId,
        clientName: (clientUser?.displayName ?? "").trim() || "Client",
        clientPhotoURL: clientUser?.photoURL ?? null,
        tradespersonName:
          (tradie.displayName ?? "").trim() ||
          (tradie.companyName ?? "").trim() ||
          "Tradesperson",
        tradespersonPhotoURL: tradie.photoURL ?? null,
        status: jobStatus,
        trade: post.trade,
        title: post.title,
        description: post.description,
        // Carry the post's trade-specific questionnaire answers onto the job so
        // the detail captured up-front survives into the job brief.
        intakeFormData: post.intakeFormData ?? {},
        intakePhotos: [], // populated post-commit after storage copy
        address: {
          line1: meta.addressPrivate.line1,
          city: post.addressPublic.city,
          region: post.addressPublic.region,
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
        cancelledBy: null,
        chatId: chatRef.id,
        sourcePostId: postId,
        ...(requiresUpfront
          ? {
              upfrontFee: {
                amountCents: upfront!.amountCents,
                source: upfront!.type,
                paymentMethod: "manual",
                paidAt: null,
                paidBy: null,
                appliedInvoiceId: null,
              },
            }
          : {}),
      });

      tx.set(chatRef, {
        jobId: jobRef.id,
        clientId: uid,
        tradespersonId: app.tradespersonId,
        lastMessageAt: null,
        lastMessagePreview: "",
        unreadCounts: { [uid]: 0, [app.tradespersonId]: 0 },
      });

      // Materialize the accepted quote at quotes/{jobId} so the job page +
      // invoice flow read it exactly like a direct-request quote.
      tx.set(quoteRef, {
        tradespersonId: app.tradespersonId,
        clientId: uid,
        jobId: jobRef.id,
        quoteNumber,
        status: "accepted",
        lineItems: quote.lineItems,
        subtotal: quote.subtotal,
        discount: quote.discount ?? null,
        discountAmount: quote.discountAmount,
        taxTotal: quote.taxTotal,
        total: quote.total,
        currency: "CAD",
        estimatedHours: quote.estimatedHours,
        proposedStartDate: quote.proposedStartDate ?? null,
        estimatedDuration: quote.estimatedDuration ?? "",
        validUntil: quote.validUntil,
        terms: quote.terms,
        noteToClient: quote.noteToClient,
        declinedReason: null,
        issuedAt: FieldValue.serverTimestamp(),
        sentAt: FieldValue.serverTimestamp(),
        viewedAt: null,
        acceptedAt: FieldValue.serverTimestamp(),
        declinedAt: null,
        pdfUrl: null,
        upfrontFee: upfront,
      });

      tx.update(db.doc(`tradespeople/${app.tradespersonId}`), { nextQuoteNumber: seq + 1 });
      tx.update(appRef, { status: "selected", updatedAt: FieldValue.serverTimestamp() });
      tx.update(postRef, {
        status: "closed",
        closedAt: FieldValue.serverTimestamp(),
        acceptedAt: FieldValue.serverTimestamp(),
        convertedJobId: jobRef.id,
      });
      tx.set(metaRef, { selectedApplicantId: app.tradespersonId }, { merge: true });

      return {
        post,
        tradespersonId: app.tradespersonId,
        quoteNumber,
        total: quote.total,
        upfrontFeeCents: requiresUpfront ? upfront!.amountCents : 0,
      };
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("acceptApplicationQuote txn failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't accept this quote.");
  }

  const { post, tradespersonId, quoteNumber, total, upfrontFeeCents } = txnOut;

  // ---------- post-commit (best-effort) ----------

  // Copy the post's photo blobs into the new job's intake/ path so they survive
  // the post's eventual expiry. Non-fatal: a copy failure just leaves
  // intakePhotos empty (placeholder in the UI) rather than rolling back.
  if (post.photos.length > 0) {
    try {
      const bucket = storage.bucket();
      const newPaths: string[] = [];
      for (const srcPath of post.photos) {
        const filename = srcPath.split("/").pop() || `${jobRef.id}.webp`;
        const destPath = `jobs/${jobRef.id}/intake/${filename}`;
        await bucket.file(srcPath).copy(bucket.file(destPath));
        newPaths.push(destPath);
      }
      await jobRef.update({ intakePhotos: newPaths });
    } catch (err) {
      logger.error("acceptApplicationQuote photo copy failed", { ...ctx, err });
    }
  }

  // Reject + notify the other pending applicants — the client picked one.
  try {
    const pendingSnap = await postRef
      .collection("applications")
      .where("status", "==", "pending")
      .get();
    const batch = db.batch();
    const rejectedTradieIds: string[] = [];
    for (const d of pendingSnap.docs) {
      if (d.id === applicationId) continue;
      batch.update(d.ref, { status: "rejected", updatedAt: FieldValue.serverTimestamp() });
      rejectedTradieIds.push((d.data() as { tradespersonId: string }).tradespersonId);
    }
    if (rejectedTradieIds.length > 0) {
      await batch.commit();
      await Promise.all(
        rejectedTradieIds.map((tid) =>
          notify({
            userId: tid,
            type: "application_rejected",
            title: "Not selected this time",
            body: `The client chose another tradesperson for "${post.title}".`,
            link: `/jobs/posted/${postId}`,
            actorUid: uid,
            recipientRole: "tradesperson",
            priority: "normal",
          }),
        ),
      );
    }
  } catch (err) {
    logger.error("acceptApplicationQuote reject-others failed", { ...ctx, err });
  }

  // Chat system line + notify the selected tradie.
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const sysMessage =
    upfrontFeeCents > 0
      ? `Client accepted quote ${quoteNumber} (${dollars(total)}). ${dollars(upfrontFeeCents)} upfront fee due before work begins.`
      : `Client accepted quote ${quoteNumber} (${dollars(total)}). Job is now active — invoice when the work is done.`;
  await postSystemMessage(chatRef.id, sysMessage);

  await notify({
    userId: tradespersonId,
    type: "application_accepted",
    title: "Your quote was accepted!",
    body:
      upfrontFeeCents > 0
        ? `${quoteNumber} accepted. Awaiting ${dollars(upfrontFeeCents)} upfront fee before you start.`
        : `${quoteNumber} (${dollars(total)}). Job is now active — invoice when finished.`,
    link: `/jobs/${jobRef.id}`,
    actorUid: uid,
    jobId: jobRef.id,
    chatId: chatRef.id,
    recipientRole: "tradesperson",
    priority: "high",
  });

  await logAdminAction({
    actorUid: uid,
    action: "acceptApplicationQuote",
    targetType: "jobPost",
    targetId: postId,
    metadata: { jobId: jobRef.id, applicationId, quoteNumber },
  });

  logger.info("acceptApplicationQuote success", { ...ctx, jobId: jobRef.id });
  return { jobId: jobRef.id, chatId: chatRef.id };
});
