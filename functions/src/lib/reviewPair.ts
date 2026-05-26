// reviewPairs/{jobId} — AirBnB-style mutual-blind review state machine.
//
// One pair doc per completed job (id == jobId, same deterministic pattern
// as invoices). The pair is created when the invoice flips to paid (the
// two callables markJobPaid + clientMarkPaid both call `ensureReviewPair`)
// and tracks who has submitted, when the 14-day window closes, whether
// the pair has been revealed, and the nudge cadence.
//
// Why a separate doc instead of mutating the review docs in place?
//   - Rules need a single load-bearing field (`revealedAt`) to decide
//     whether the counterparty can read the review. Computing that from
//     "does the other review exist" would require a get() on every read.
//   - Aggregation onto the tradesperson's public ratingAvg must happen
//     only at reveal time. Otherwise the tradie could infer the client's
//     hidden score from a delta in their own running average and the
//     "blind" promise is broken. The pair doc gives us a clean place to
//     hang the reveal-once-and-only-once side effect.
//   - The scheduled nudge needs a queryable surface — `where("locked",
//     "==", false)` on an inbox of pairs is cheap; reconstructing the
//     same view from joining reviews + clientReviews is not.
//
// All callsites pass the same triplet (jobId, clientId, tradespersonId)
// they already have on hand — no extra reads to set up the pair.

import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "./admin";
import { notify } from "./notify";

// 14-day mutual-blind window. Mirrors design.md § 4.4. The AirBnB
// equivalent — once it passes, the late party can no longer submit and
// the existing reviews go live solo.
export const REVIEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Aggregation dimension keys for the public (client → tradie) review.
const TRADIE_DIM_KEYS = [
  "quality",
  "punctuality",
  "communication",
  "value",
] as const;

interface ReviewPairData {
  jobId: string;
  clientId: string;
  tradespersonId: string;
  invoicePaidAt: Timestamp;
  deadlineAt: Timestamp;
  clientSubmittedAt: Timestamp | null;
  tradieSubmittedAt: Timestamp | null;
  clientReviewId: string | null;
  tradieReviewId: string | null;
  revealedAt: Timestamp | null;
  lastNudgedAt: Timestamp | null;
  nudgeCount: number;
  locked: boolean;
}

function pairRef(jobId: string): DocumentReference {
  return db.doc(`reviewPairs/${jobId}`);
}

function isValidScore(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 5;
}

/**
 * Idempotently create the reviewPairs/{jobId} doc when an invoice flips
 * to paid. Both `markJobPaid` (tradie path) and `clientMarkPaid` (client
 * path) call this — whichever fires second is a no-op. Notification fan-
 * out is left to the callsite (we want it tied to the specific actor uid
 * so the in-app inbox shows the right "review requested by you" framing).
 *
 * Returns the resulting pair doc so the callsite can decide whether to
 * notify (only on the create branch) or stay silent (already existed).
 */
export async function ensureReviewPair(input: {
  jobId: string;
  clientId: string;
  tradespersonId: string;
}): Promise<{ created: boolean; pair: ReviewPairData }> {
  const { jobId, clientId, tradespersonId } = input;
  const ref = pairRef(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      return { created: false, pair: snap.data() as ReviewPairData };
    }
    const now = Timestamp.now();
    const deadlineAt = Timestamp.fromMillis(now.toMillis() + REVIEW_WINDOW_MS);
    const pair: ReviewPairData = {
      jobId,
      clientId,
      tradespersonId,
      invoicePaidAt: now,
      deadlineAt,
      clientSubmittedAt: null,
      tradieSubmittedAt: null,
      clientReviewId: null,
      tradieReviewId: null,
      revealedAt: null,
      lastNudgedAt: null,
      nudgeCount: 0,
      locked: false,
    };
    tx.set(ref, pair);
    return { created: true, pair };
  });
}

/**
 * Stamp the pair when one side submits their review. If the counterparty
 * already submitted, reveal both reviews + run aggregation. Otherwise
 * notify the counterparty so they know the ball's in their court.
 *
 * Called from the onReviewCreated / onClientReviewCreated triggers. Each
 * side passes its own type literal so we know which timestamp + review-
 * id slot to fill.
 *
 * Defensive: if the pair doesn't exist yet (review was somehow created
 * before the invoice was marked paid — e.g. a tradie self-testing in
 * staging), we lazily seed one with a fresh deadline. Keeps the trigger
 * idempotent and prevents the reveal flow from getting stuck.
 */
export async function recordSubmission(input: {
  jobId: string;
  clientId: string;
  tradespersonId: string;
  reviewId: string;
  // Which side submitted. "client" -> reviews/{id} (public); "tradesperson"
  // -> clientReviews/{id} (private).
  submittedBy: "client" | "tradesperson";
}): Promise<void> {
  const { jobId, clientId, tradespersonId, reviewId, submittedBy } = input;
  const ref = pairRef(jobId);

  // Step 1: transactional pair update so we never lose a concurrent
  // submission. The transaction itself doesn't perform the reveal — it
  // returns enough state for the caller to decide.
  const result = await db.runTransaction(
    async (
      tx,
    ): Promise<{
      shouldReveal: boolean;
      counterpartyUid: string;
      counterpartyAlreadySubmitted: boolean;
      pair: ReviewPairData;
    }> => {
      const snap = await tx.get(ref);
      const now = Timestamp.now();

      let pair: ReviewPairData;
      if (snap.exists) {
        pair = snap.data() as ReviewPairData;
      } else {
        // Lazy seed (see fn comment). Stamp the deadline from now so the
        // late client gets the full window from the first observed
        // submission rather than a tiny remainder.
        pair = {
          jobId,
          clientId,
          tradespersonId,
          invoicePaidAt: now,
          deadlineAt: Timestamp.fromMillis(now.toMillis() + REVIEW_WINDOW_MS),
          clientSubmittedAt: null,
          tradieSubmittedAt: null,
          clientReviewId: null,
          tradieReviewId: null,
          revealedAt: null,
          lastNudgedAt: null,
          nudgeCount: 0,
          locked: false,
        };
        tx.set(ref, pair);
      }

      const update: Partial<ReviewPairData> = {};
      if (submittedBy === "client") {
        update.clientSubmittedAt = now;
        update.clientReviewId = reviewId;
        pair.clientSubmittedAt = now;
        pair.clientReviewId = reviewId;
      } else {
        update.tradieSubmittedAt = now;
        update.tradieReviewId = reviewId;
        pair.tradieSubmittedAt = now;
        pair.tradieReviewId = reviewId;
      }
      tx.update(ref, update);

      const counterpartyAlreadySubmitted =
        submittedBy === "client"
          ? pair.tradieSubmittedAt != null
          : pair.clientSubmittedAt != null;
      const counterpartyUid =
        submittedBy === "client" ? tradespersonId : clientId;

      return {
        shouldReveal: counterpartyAlreadySubmitted && !pair.revealedAt,
        counterpartyUid,
        counterpartyAlreadySubmitted,
        pair,
      };
    },
  );

  // Step 2: side effects outside the transaction. Reveal does its own
  // separate transaction so a single retry doesn't double-aggregate.
  if (result.shouldReveal) {
    await revealPair(jobId, "mutual");
    return;
  }

  // Step 2b: not revealed yet — nudge the counterparty so they know it's
  // their move. The notification copy + link both point to the modal-
  // opening deep link.
  const baseLink = `/jobs/${jobId}`;
  await notify({
    userId: result.counterpartyUid,
    type: "review_requested",
    title:
      submittedBy === "client"
        ? "Your client left you a review"
        : "Your tradesperson left you a review",
    body: "Submit yours to unlock theirs. Reviews stay hidden until both are in.",
    link: baseLink,
    jobId,
    actorUid: submittedBy === "client" ? clientId : tradespersonId,
    recipientRole: submittedBy === "client" ? "tradesperson" : "client",
    priority: "normal",
  });
}

/**
 * Flip both reviews' `revealedAt` and the pair's `revealedAt + locked` in
 * a single transaction, then aggregate the rating onto the relevant
 * subject doc (public review → tradie's ratingAvg; private review →
 * client's clientRatingAvg). Idempotent — re-running this on an already-
 * revealed pair is a no-op.
 *
 * `trigger` is just for the log/notification copy:
 *   - "mutual"  — both sides submitted; reveal is happy-path.
 *   - "deadline" — 14-day window closed; reveal is forced and the late
 *     side never gets to submit. Notifications skip the "your review is
 *     live" celebration in that case.
 */
export async function revealPair(
  jobId: string,
  trigger: "mutual" | "deadline",
): Promise<void> {
  const ref = pairRef(jobId);

  const result = await db.runTransaction(
    async (
      tx,
    ): Promise<{
      pair: ReviewPairData;
      clientReview: { ref: DocumentReference; data: ReviewLike } | null;
      tradieReview: { ref: DocumentReference; data: ClientReviewLike } | null;
      didReveal: boolean;
    } | null> => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        logger.warn("revealPair: pair missing", { jobId });
        return null;
      }
      const pair = snap.data() as ReviewPairData;
      // Idempotency: already revealed AND already locked = nothing to do.
      // (A re-fired "mutual" reveal on an already-revealed pair is a
      // no-op; a deadline force-reveal on an already-locked one too.)
      const alreadyDone = pair.revealedAt != null && pair.locked;
      const now = Timestamp.now();

      // Reads must come before writes inside a Firestore transaction.
      const clientReviewSnap = pair.clientReviewId
        ? await tx.get(db.doc(`reviews/${pair.clientReviewId}`))
        : null;
      const tradieReviewSnap = pair.tradieReviewId
        ? await tx.get(db.doc(`clientReviews/${pair.tradieReviewId}`))
        : null;

      if (alreadyDone) {
        return {
          pair,
          clientReview: snapToReview(clientReviewSnap),
          tradieReview: snapToClientReview(tradieReviewSnap),
          didReveal: false,
        };
      }

      tx.update(ref, {
        revealedAt: pair.revealedAt ?? now,
        locked: true,
      });

      // Reveal each review that exists. Some reveals are partial (one
      // side never submitted before deadline) — that's fine, the side
      // that submitted still goes live.
      if (clientReviewSnap?.exists && !clientReviewSnap.get("revealedAt")) {
        tx.update(clientReviewSnap.ref, { revealedAt: now });
      }
      if (tradieReviewSnap?.exists && !tradieReviewSnap.get("revealedAt")) {
        tx.update(tradieReviewSnap.ref, { revealedAt: now });
      }

      // Mirror the new state into the returned struct so the aggregator
      // sees revealedAt populated.
      pair.revealedAt = pair.revealedAt ?? now;
      pair.locked = true;

      return {
        pair,
        clientReview: snapToReview(clientReviewSnap),
        tradieReview: snapToClientReview(tradieReviewSnap),
        didReveal: true,
      };
    },
  );

  if (!result) return;
  if (!result.didReveal) {
    logger.info("revealPair: already revealed", { jobId, trigger });
    return;
  }

  // Aggregate onto the subject docs. Aggregation runs *after* the reveal
  // transaction so a partial failure (e.g. tradesperson doc deleted)
  // doesn't undo the reveal — rules + UI both depend on revealedAt being
  // set, and the public score can be re-derived later if needed.
  if (result.clientReview) {
    await aggregateTradespersonRating(
      result.pair.tradespersonId,
      result.clientReview.data,
    ).catch((err) => {
      logger.error("revealPair: tradesperson aggregation failed", { jobId, err });
    });
  }
  if (result.tradieReview) {
    await aggregateClientRating(
      result.pair.clientId,
      result.tradieReview.data,
    ).catch((err) => {
      logger.error("revealPair: client aggregation failed", { jobId, err });
    });
  }

  // Notify both parties — the framing differs by trigger.
  const link = `/jobs/${jobId}`;
  if (trigger === "mutual") {
    await Promise.all([
      notify({
        userId: result.pair.tradespersonId,
        type: "review_revealed",
        title: "Reviews are live",
        body: "Your client's review is visible now. Tap to read it.",
        link,
        jobId,
        actorUid: result.pair.clientId,
        recipientRole: "tradesperson",
        priority: "normal",
      }),
      notify({
        userId: result.pair.clientId,
        type: "review_revealed",
        title: "Reviews are live",
        body: "Your tradesperson's review is visible now. Tap to read it.",
        link,
        jobId,
        actorUid: result.pair.tradespersonId,
        recipientRole: "client",
        priority: "normal",
      }),
    ]);
  } else {
    // Deadline reveal — at least one side never submitted. Only ping the
    // side(s) that have a review to read; nagging the non-submitter with
    // "your peer's review is live" rubs salt in.
    const tasks: Promise<void>[] = [];
    if (result.clientReview && result.pair.tradieSubmittedAt) {
      tasks.push(
        notify({
          userId: result.pair.tradespersonId,
          type: "review_revealed",
          title: "Reviews are live",
          body: "Your client's review is visible now.",
          link,
          jobId,
          actorUid: result.pair.clientId,
          recipientRole: "tradesperson",
          priority: "normal",
        }),
      );
    }
    if (result.tradieReview && result.pair.clientSubmittedAt) {
      tasks.push(
        notify({
          userId: result.pair.clientId,
          type: "review_revealed",
          title: "Reviews are live",
          body: "Your tradesperson's review is visible now.",
          link,
          jobId,
          actorUid: result.pair.tradespersonId,
          recipientRole: "client",
          priority: "normal",
        }),
      );
    }
    await Promise.all(tasks);
  }
}

// ---------------------------------------------------------------------------
// Aggregation helpers (moved out of onReviewCreated so they only run at
// reveal time). Each writes to the subject doc in a small transaction so
// concurrent reveals on the same subject can't corrupt the running avg.
// ---------------------------------------------------------------------------

interface ReviewLike {
  rating: number;
  dimensions?: {
    quality?: unknown;
    punctuality?: unknown;
    communication?: unknown;
    value?: unknown;
  };
}

interface ClientReviewLike {
  rating: number;
}

async function aggregateTradespersonRating(
  tradespersonId: string,
  review: ReviewLike,
): Promise<void> {
  if (!isValidScore(review.rating)) {
    logger.warn("aggregateTradespersonRating: rating out of bounds; skipping", {
      tradespersonId,
      rating: review.rating,
    });
    return;
  }
  const tradieRef = db.doc(`tradespeople/${tradespersonId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(tradieRef);
    if (!snap.exists) {
      logger.warn("aggregateTradespersonRating: tradie doc missing", {
        tradespersonId,
      });
      return;
    }
    const data = snap.data() as {
      ratingAvg?: number;
      ratingCount?: number;
      ratingDimensions?: Record<string, { avg: number; count: number }>;
    };
    const newCount = (data.ratingCount ?? 0) + 1;
    const newAvg =
      ((data.ratingAvg ?? 0) * (data.ratingCount ?? 0) + review.rating) /
      newCount;

    const dims: Record<string, { avg: number; count: number }> = {
      ...(data.ratingDimensions ?? {}),
    };
    if (review.dimensions) {
      for (const k of TRADIE_DIM_KEYS) {
        const score = review.dimensions[k];
        if (!isValidScore(score)) continue;
        const prev = dims[k] ?? { avg: 0, count: 0 };
        const next = prev.count + 1;
        dims[k] = {
          avg: (prev.avg * prev.count + score) / next,
          count: next,
        };
      }
    }
    tx.update(tradieRef, {
      ratingAvg: newAvg,
      ratingCount: newCount,
      ratingDimensions: dims,
      lastReviewAt: FieldValue.serverTimestamp(),
    });
  });
}

async function aggregateClientRating(
  clientId: string,
  review: ClientReviewLike,
): Promise<void> {
  if (!isValidScore(review.rating)) {
    logger.warn("aggregateClientRating: rating out of bounds; skipping", {
      clientId,
      rating: review.rating,
    });
    return;
  }
  const userRef = db.doc(`users/${clientId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) {
      logger.warn("aggregateClientRating: user doc missing", { clientId });
      return;
    }
    const data = snap.data() as {
      clientRatingAvg?: number;
      clientRatingCount?: number;
    };
    const newCount = (data.clientRatingCount ?? 0) + 1;
    const newAvg =
      ((data.clientRatingAvg ?? 0) * (data.clientRatingCount ?? 0) +
        review.rating) /
      newCount;
    tx.update(userRef, {
      clientRatingAvg: newAvg,
      clientRatingCount: newCount,
    });
  });
}

// Internal helpers — keep the transactional snapshot work compact above.
function snapToReview(
  snap: DocumentSnapshot | null,
): { ref: DocumentReference; data: ReviewLike } | null {
  if (!snap?.exists) return null;
  return { ref: snap.ref, data: snap.data() as ReviewLike };
}

function snapToClientReview(
  snap: DocumentSnapshot | null,
): { ref: DocumentReference; data: ClientReviewLike } | null {
  if (!snap?.exists) return null;
  return { ref: snap.ref, data: snap.data() as ClientReviewLike };
}

// Re-exported for the scheduled nudge — keeps the type local to this file.
export type { ReviewPairData };

// Transaction type is re-exported in case future callers want to compose;
// not used internally yet but spares the awkward import path.
export type { Transaction };
