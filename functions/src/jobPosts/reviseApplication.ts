import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRoleOrAdmin } from "../lib/auth";
import { requireVisibleTradie } from "./helpers";
import { notify } from "../lib/notify";
import { LineItemSchema, DiscountSchema, UpfrontFeeSchema } from "../lib/quoteSchemas";
import { computeTotals, resolveUpfrontFee } from "../lib/quoteTotals";
import { postApplicationSystemMessage } from "./applicationThread";

// Tradesperson resubmits a revised quote on an existing PENDING application
// (the negotiation outcome of the Q&A thread). Reuses submitApplication's exact
// server-side recompute so totals stay authoritative, but updates in place —
// it must NOT increment private/meta.applicationCount or burn the daily-apply
// rate limit (a revise isn't a new application). submitApplication hard-blocks
// resubmission on purpose, so this is a separate callable rather than relaxing it.
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
  message: z.string().trim().max(2000).optional(),
  quote: QuoteInput,
  proposedStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const reviseApplication = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRoleOrAdmin(req, "tradesperson");
  await requireVisibleTradie(uid);

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { postId, message, quote, proposedStartDate } = parsed.data;
  const ctx = { fn: "reviseApplication", uid, postId };

  // Recompute every total server-side, identical to submitApplication.
  const totals = computeTotals(quote.lineItems, quote.discount);
  if (totals.total <= 0) {
    throw new HttpsError("failed-precondition", "Quote total must be greater than zero.");
  }
  const preTaxBase = Math.max(0, totals.subtotal - totals.discountAmount);
  const upfrontFee = resolveUpfrontFee(quote.upfrontFee, preTaxBase);
  const validUntil = Timestamp.fromMillis(Date.now() + quote.validUntilDays * 24 * 60 * 60 * 1000);
  const proposedStartTs = proposedStartDate
    ? Timestamp.fromDate(new Date(`${proposedStartDate}T00:00:00Z`))
    : null;

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

  let clientId: string;
  try {
    clientId = await db.runTransaction(async (tx) => {
      const [postSnap, appSnap] = await Promise.all([tx.get(postRef), tx.get(appRef)]);
      if (!postSnap.exists) throw new HttpsError("not-found", "Job post not found.");
      const post = postSnap.data() as { status: string; clientId: string; expiresAt?: Timestamp };
      if (post.status !== "open") {
        throw new HttpsError("failed-precondition", "This job post is no longer open.");
      }
      if (post.expiresAt && post.expiresAt.toMillis() < Date.now()) {
        throw new HttpsError("failed-precondition", "This job post has expired.");
      }
      if (!appSnap.exists) throw new HttpsError("not-found", "You haven't applied to this post.");
      const app = appSnap.data() as { status: string };
      // Revise from pending (proactively sweeten the bid) OR from declined
      // (the client passed with a reason — revise re-enters the active list).
      // selected/rejected/withdrawn are terminal.
      if (app.status !== "pending" && app.status !== "declined") {
        throw new HttpsError(
          "failed-precondition",
          `You can't revise a ${app.status} application.`,
        );
      }
      const wasDeclined = app.status === "declined";

      tx.update(appRef, {
        quote: applicationQuote,
        proposedPrice,
        proposedStartDate: proposedStartTs,
        // Attaching a full quote makes this a full application whatever it
        // started as — in particular a "chat" opener graduates to a real bid
        // the client can accept.
        kind: "full",
        ...(message ? { message } : {}),
        // Re-entering the active list: clear the decline + flip back to pending.
        ...(wasDeclined
          ? { status: "pending", declinedReason: null, declinedAt: null }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
        revisedAt: FieldValue.serverTimestamp(),
        revisionCount: FieldValue.increment(1),
      });
      // Re-incrementing the active count mirrors declineApplication's
      // decrement so the count stays = active applicants. No rate-limit bump
      // either way — a revise isn't a new application.
      if (wasDeclined) {
        tx.set(metaRef, { applicationCount: FieldValue.increment(1) }, { merge: true });
      }
      return post.clientId;
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("reviseApplication failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't revise your quote.");
  }

  // Post-commit (best-effort): drop a system line into the thread + notify the
  // client. A revised quote is a decision-relevant event, so priority high.
  const dollars = `$${(totals.total / 100).toFixed(2)}`;
  await postApplicationSystemMessage(
    postId,
    uid,
    `Submitted a revised quote — new total ${dollars}.`,
  );
  await notify({
    userId: clientId,
    type: "application_message",
    title: "Revised quote received",
    body: `An applicant updated their quote — new total ${dollars}.`,
    link: `/jobs/posted/${postId}`,
    actorUid: uid,
    recipientRole: "client",
    priority: "high",
  });

  logger.info("reviseApplication success", { ...ctx, total: totals.total });
  return { ok: true };
});
