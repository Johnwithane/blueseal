import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { deriveIsPro, type SubscriptionState } from "../lib/subscription";

/**
 * Daily scan: founding-member comps (users/{uid}.subscription.proCompUntil)
 * expire silently — no Stripe event fires — so the public tradespeople/{uid}.
 * isPro mirror would stay true forever without this sweep. For each user whose
 * comp has lapsed, recompute Pro from whatever real (Stripe) status remains,
 * flip the mirror, and clear the stale comp marker so the doc drops out of
 * tomorrow's scan (keeps the working set empty as the cohort grows).
 *
 * Single-field index on subscription.proCompUntil is auto-created by Firestore
 * (no composite needed).
 */
export const scheduledProCompExpiry = onSchedule(
  { schedule: "every day 03:30", timeZone: "America/Vancouver" },
  async () => {
    const now = Timestamp.now();
    const snap = await db
      .collection("users")
      .where("subscription.proCompUntil", "<=", now)
      .limit(500)
      .get();
    if (snap.empty) {
      logger.info("scheduledProCompExpiry: nothing to expire");
      return;
    }

    const batch = db.batch();
    let flipped = 0;
    for (const doc of snap.docs) {
      const sub = doc.data().subscription as SubscriptionState | undefined;
      if (!sub) continue;
      // Comp has lapsed (query guarantees proCompUntil <= now). isPro now
      // depends only on any remaining Stripe status.
      const clearedSub: SubscriptionState = { ...sub, proCompUntil: null };
      const isPro = deriveIsPro(clearedSub, now);
      // Targeted nested-field patch (doc exists — it came from the query) so
      // sibling Stripe fields on subscription are untouched.
      batch.update(doc.ref, {
        "subscription.proCompUntil": null,
        "subscription.updatedAt": FieldValue.serverTimestamp(),
      });
      // Mirror to the tradesperson doc (comp is only ever granted to
      // tradespeople, so the doc exists; merge keeps it harmless otherwise).
      batch.set(db.doc(`tradespeople/${doc.id}`), { isPro }, { merge: true });
      flipped += 1;
    }
    await batch.commit();
    logger.info(`scheduledProCompExpiry: processed ${flipped} expired comps`);
  },
);
