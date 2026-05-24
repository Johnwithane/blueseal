// One-shot admin callable: seed `payouts: emptyPayoutsState()` onto every
// approved tradesperson doc that doesn't already have the field. This is
// the migration prep that lets the (still-deferred) `maybeMarkVisible`
// tightening land safely — once every approved tradie's doc carries
// payouts.payoutsEnabled (defaulting to false), gating visibility on
// payoutsEnabled === true won't NPE on pre-cutover docs.
//
// Idempotent: re-running is a no-op for docs that already have `payouts`.
// Batched in chunks of 400 (Firestore's WriteBatch hard limit is 500;
// 400 leaves headroom for the next page).
//
// Reads `vettingStatus == approved` rather than the full collection so
// we skip draft/pending/rejected docs that the migration doesn't care
// about (they'll get the field naturally if they ever reach approved
// through the normal vetting flow, since seedPayoutsOnApproval is a
// reasonable follow-up but not in this commit's scope).

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { emptyPayoutsState } from "./stripeClient";

const PAGE_SIZE = 400;

interface BackfillResult {
  scanned: number;
  updated: number;
  alreadyPresent: number;
  pages: number;
}

export const backfillPayoutsField = onCall(
  { enforceAppCheck: false },
  async (req): Promise<BackfillResult> => {
    const actor = requireAdmin(req);

    let scanned = 0;
    let updated = 0;
    let alreadyPresent = 0;
    let pages = 0;
    let lastDocId: string | null = null;

    // Page by document id (deterministic ordering on __name__) so a long
    // run that's interrupted halfway can be re-invoked safely — the doc
    // pages we already touched are no-ops on the second pass, and the
    // pages we hadn't reached get picked up.
    //
    // No `orderBy` is needed for the `vettingStatus == approved` filter;
    // Firestore's default doc-id ordering is what `startAfter` keys off.
    while (true) {
      let query = db
        .collection("tradespeople")
        .where("vettingStatus", "==", "approved")
        .limit(PAGE_SIZE);
      if (lastDocId) {
        const cursor = await db.doc(`tradespeople/${lastDocId}`).get();
        query = query.startAfter(cursor);
      }
      const snap = await query.get();
      if (snap.empty) break;
      pages += 1;
      scanned += snap.size;

      const batch = db.batch();
      let batchWrites = 0;
      for (const docSnap of snap.docs) {
        if (docSnap.get("payouts")) {
          alreadyPresent += 1;
          continue;
        }
        batch.set(
          docSnap.ref,
          { payouts: emptyPayoutsState() },
          { merge: true },
        );
        batchWrites += 1;
      }
      if (batchWrites > 0) {
        await batch.commit();
        updated += batchWrites;
      }

      lastDocId = snap.docs[snap.docs.length - 1].id;
      if (snap.size < PAGE_SIZE) break;
    }

    await logAdminAction({
      actorUid: actor,
      action: "backfillPayoutsField",
      targetType: "tradespeople",
      targetId: "*",
      metadata: { scanned, updated, alreadyPresent, pages },
    });

    logger.info("backfillPayoutsField: done", {
      scanned,
      updated,
      alreadyPresent,
      pages,
      actor,
    });

    if (scanned === 0) {
      // Not an error per se, but worth surfacing — the caller probably
      // expected at least some docs. Throwing keeps the admin UI from
      // claiming success when nothing actually happened.
      throw new HttpsError(
        "not-found",
        "No approved tradespeople found. Backfill had nothing to do.",
      );
    }

    return { scanned, updated, alreadyPresent, pages };
  },
);
