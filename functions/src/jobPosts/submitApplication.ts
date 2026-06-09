import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRoleOrAdmin } from "../lib/auth";
import { requireVisibleTradie, rateLimitKey } from "./helpers";
import { notify } from "../lib/notify";
import { LineItemSchema, DiscountSchema, UpfrontFeeSchema } from "../lib/quoteSchemas";
import { computeTotals, resolveUpfrontFee } from "../lib/quoteTotals";

// Itemized quote carried on the application — the bid the client compares and
// accepts. Mirrors submitQuote's input; totals are recomputed server-side.
const QuoteInput = z.object({
  lineItems: z.array(LineItemSchema).min(1).max(40),
  discount: DiscountSchema.nullable().default(null),
  estimatedHours: z.number().min(0).max(10_000).nullable().default(null),
  validUntilDays: z.number().int().min(1).max(180).default(14),
  terms: z.string().max(2000).default(""),
  noteToClient: z.string().max(500).default(""),
  upfrontFee: UpfrontFeeSchema.nullable().default(null),
  estimatedDuration: z.string().max(80).default(""),
});

const Input = z.object({
  postId: z.string().min(1).max(128),
  message: z.string().trim().min(20).max(2000),
  quote: QuoteInput,
  proposedStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

const DAILY_APPLICATION_CAP = 10;

export const submitApplication = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRoleOrAdmin(req, "tradesperson");
  // Admins still need a tradesperson doc with isVisible:true to apply —
  // they don't get a free pass on the verified-tradie contract.
  await requireVisibleTradie(uid);

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { postId, message, quote, proposedStartDate } = parsed.data;
  const ctx = { fn: "submitApplication", uid, postId };

  // Recompute every total server-side so a tampered payload can't misstate the
  // bid the client will accept. Mirrors submitQuote exactly (shared helpers).
  const totals = computeTotals(quote.lineItems, quote.discount);
  if (totals.total <= 0) {
    throw new HttpsError("failed-precondition", "Quote total must be greater than zero.");
  }
  const preTaxBase = Math.max(0, totals.subtotal - totals.discountAmount);
  const upfrontFee = resolveUpfrontFee(quote.upfrontFee, preTaxBase);
  const validUntil = Timestamp.fromMillis(
    Date.now() + quote.validUntilDays * 24 * 60 * 60 * 1000,
  );
  // Calendar date → UTC midnight (a date, not an instant). Reused for the
  // top-level application field and the embedded quote snapshot.
  const proposedStartTs = proposedStartDate
    ? Timestamp.fromDate(new Date(`${proposedStartDate}T00:00:00Z`))
    : null;

  // The stored quote snapshot + a one-line proposedPrice derived from the
  // total so existing list/notification rendering keeps working.
  const applicationQuote = {
    lineItems: quote.lineItems,
    subtotal: totals.subtotal,
    discount: quote.discount,
    discountAmount: totals.discountAmount,
    taxTotal: totals.taxTotal,
    total: totals.total,
    currency: "CAD",
    upfrontFee,
    estimatedHours: quote.estimatedHours,
    proposedStartDate: proposedStartTs,
    estimatedDuration: quote.estimatedDuration,
    validUntil,
    terms: quote.terms,
    noteToClient: quote.noteToClient,
  };
  const proposedPrice = { type: "fixed" as const, amount: totals.total };

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
        quote: applicationQuote,
        proposedStartDate: proposedStartTs,
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

    // Notify the client outside the transaction. This callable is the single
    // source of the new_application notification — one application doc = one
    // notify. Re-applies are blocked above (already-exists throws), so this
    // fires exactly once per applicant. (Previously an onApplicationCreated
    // trigger also notified here "belt-and-suspenders"; that produced a
    // guaranteed duplicate in the client's inbox on every application, so it
    // was removed. Mirrors submitQuote, which notifies synchronously with no
    // paired trigger.)
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
