import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

const DIM_KEYS = ["quality", "punctuality", "communication", "value"] as const;
const validScore = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 5;

const Input = z.object({
  kind: z.enum(["review", "jobPost"]),
  id: z.string().min(1).max(128),
  hidden: z.boolean(),
});

/**
 * Recompute a tradesperson's public rating aggregate from their ACTIVE +
 * revealed reviews. The incremental aggregation in reviewPair.ts can't subtract
 * a hidden review, so after a hide/recover we recompute from scratch (self-
 * correcting). Same query shape as listReviewsFor, so it reuses that index.
 * Best-effort — a failure here must not block the moderation action itself.
 */
async function recomputeTradieRating(tradespersonId: string): Promise<void> {
  const snap = await db
    .collection("reviews")
    .where("tradespersonId", "==", tradespersonId)
    .where("status", "==", "active")
    .where("revealedAt", "!=", null)
    .get();
  let count = 0;
  let sum = 0;
  const acc: Record<string, { sum: number; count: number }> = {};
  for (const d of snap.docs) {
    const r = d.data() as { rating?: number; dimensions?: Record<string, unknown> };
    if (!validScore(r.rating)) continue;
    count += 1;
    sum += r.rating;
    for (const k of DIM_KEYS) {
      const s = r.dimensions?.[k];
      if (!validScore(s)) continue;
      const cur = acc[k] ?? { sum: 0, count: 0 };
      acc[k] = { sum: cur.sum + s, count: cur.count + 1 };
    }
  }
  const ratingDimensions: Record<string, { avg: number; count: number }> = {};
  for (const [k, v] of Object.entries(acc)) ratingDimensions[k] = { avg: v.sum / v.count, count: v.count };
  await db.doc(`tradespeople/${tradespersonId}`).set(
    { ratingAvg: count ? sum / count : 0, ratingCount: count, ratingDimensions },
    { merge: true },
  );
}

/**
 * Admin moderation — soft-hide or recover a public review or a job-board post.
 * Recoverable: nothing is deleted.
 *
 * - review: flips ReviewDoc.status active<->hidden. listReviewsFor + the public
 *   read rule already exclude non-active, so a hidden review drops off profiles.
 *   The tradie's rating aggregate is then recomputed so a removed review stops
 *   counting.
 * - jobPost: sets status "admin_hidden" — a NON-terminal status the feed + the
 *   public read gate (status=="open") exclude, and which onJobPostClosed ignores
 *   (so pending applications are preserved, not auto-rejected). The prior status
 *   is captured in statusBeforeHide and restored on recover.
 */
export const adminModerateContent = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { kind, id, hidden } = parsed.data;

  if (kind === "review") {
    const ref = db.doc(`reviews/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Review not found.");
    const tradespersonId = (snap.data() as { tradespersonId?: string }).tradespersonId;
    await ref.update({ status: hidden ? "hidden" : "active" });
    if (tradespersonId) {
      try {
        await recomputeTradieRating(tradespersonId);
      } catch (err) {
        logger.error("adminModerateContent: rating recompute failed", { id, err: (err as Error).message });
      }
    }
  } else {
    const ref = db.doc(`jobPosts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Job post not found.");
    const cur = snap.data() as { status?: string; statusBeforeHide?: string | null };
    if (hidden) {
      // Idempotent: don't clobber the captured prior status if already hidden.
      const prior = cur.status === "admin_hidden" ? cur.statusBeforeHide ?? "open" : cur.status ?? "open";
      await ref.update({ status: "admin_hidden", statusBeforeHide: prior });
    } else {
      await ref.update({ status: cur.statusBeforeHide ?? "open", statusBeforeHide: null });
    }
  }

  await logAdminAction({
    actorUid: actor,
    action: hidden ? "adminHideContent" : "adminRestoreContent",
    targetType: kind,
    targetId: id,
  });
  logger.info("adminModerateContent", { actor, kind, id, hidden });
  return { ok: true as const };
});
