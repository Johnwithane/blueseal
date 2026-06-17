import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";

/**
 * Shared daily ceiling for AI/Vertex callables, counted per user across all AI
 * endpoints under the `"ai"` bucket. Generous enough that no legitimate
 * tradesperson hits it in a day's work, low enough that a runaway loop is
 * capped before it becomes a meaningful bill.
 */
export const AI_DAILY_CAP = 100;

/**
 * Per-(uid, action, day) daily cap backed by a `rateLimits/{id}` doc. Mirrors
 * the transactional counter in jobPosts/submitApplication so concurrent calls
 * can't race past the cap.
 *
 * This is the cost-control guard for the AI / Vertex callables. Those are
 * pay-per-token, and until App Check is enforced they're reachable by any
 * signed-in user (signup is self-serve and the tradesperson role is
 * self-grantable), so a single account could otherwise loop an expensive
 * endpoint and run up the Vertex bill. The counter is incremented *before* the
 * Vertex call so an abusive caller is stopped before spending money.
 *
 * Throws `resource-exhausted` (surfaced to the client as a friendly message)
 * when the cap is hit. `rateLimits/` is server-only in firestore.rules, so the
 * count can't be tampered with from the client.
 */
export async function enforceRateLimit(
  uid: string,
  action: string,
  dailyCap: number,
  // Non-AI callers (auth emails, etc.) pass their own message so a hit doesn't
  // surface the AI-specific copy. Defaults to the AI-cap wording.
  message?: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`rateLimits/${action}_${uid}_${today}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = (snap.data() as { count?: number } | undefined)?.count ?? 0;
    if (count >= dailyCap) {
      throw new HttpsError(
        "resource-exhausted",
        message ??
          `Daily AI usage limit reached (${dailyCap} requests). Please try again tomorrow.`,
      );
    }
    tx.set(
      ref,
      { count: count + 1, action, uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  });
}
