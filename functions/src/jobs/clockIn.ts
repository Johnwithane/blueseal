import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";

const Input = z.object({
  jobId: z.string().min(1).max(128),
});

/**
 * Open a new time entry for the assigned tradesperson. Transactional so
 * the "one open entry per tradie per job" invariant holds even under
 * concurrent calls (double-tap on a flaky mobile connection); rules
 * can't enforce uniqueness across docs.
 *
 * Snapshots `hourlyRate` from the tradesperson profile at clock-in time
 * so a later profile rate change doesn't re-price past sessions. If the
 * tradie has no profile rate set (e.g. pricingModel === "quote"), the
 * snapshot is 0 — the entry still records the time, and the tradie can
 * manually price the resulting invoice line.
 */
export const clockIn = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);

  const { jobId } = parsed.data;
  const jobRef = db.doc(`jobs/${jobId}`);
  const tradieRef = db.doc(`tradespeople/${uid}`);

  return await db.runTransaction(async (tx) => {
    const [jobSnap, tradieSnap] = await Promise.all([tx.get(jobRef), tx.get(tradieRef)]);

    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as { tradespersonId?: string; clientId?: string; status?: string; chatId?: string };
    if (job.tradespersonId !== uid) {
      throw new HttpsError("permission-denied", "Only the assigned tradesperson can clock in.");
    }
    if (job.status === "cancelled") {
      throw new HttpsError("failed-precondition", "Can't clock in on a cancelled job.");
    }
    if (!job.clientId) {
      throw new HttpsError("failed-precondition", "Job is missing a client.");
    }

    const openQuery = jobRef
      .collection("timeEntries")
      .where("tradespersonId", "==", uid)
      .where("endedAt", "==", null)
      .limit(1);
    const openSnap = await tx.get(openQuery);
    if (!openSnap.empty) {
      throw new HttpsError(
        "failed-precondition",
        "You're already clocked in on this job. Stop the running session first.",
      );
    }

    const tradieData = tradieSnap.exists
      ? (tradieSnap.data() as { hourlyRate?: number | null })
      : null;
    const rate = Math.max(0, Math.floor(tradieData?.hourlyRate ?? 0));

    const entryRef = jobRef.collection("timeEntries").doc();
    tx.set(entryRef, {
      tradespersonId: uid,
      clientId: job.clientId,
      startedAt: FieldValue.serverTimestamp(),
      endedAt: null,
      hourlyRateSnapshot: rate,
      notes: "",
      source: "clock",
      invoicedAt: null,
    });

    logger.info("clockIn", { jobId, tradespersonId: uid, entryId: entryRef.id, rate });
    return { entryId: entryRef.id, chatId: job.chatId ?? null };
  }).then(async (res) => {
    // Post-commit side effect: a chat write failure shouldn't roll back the
    // time entry. postSystemMessage already swallows its own errors.
    if (res.chatId) await postSystemMessage(res.chatId, "Tradesperson clocked in");
    return { entryId: res.entryId };
  });
});

/**
 * Exported for testing-ish parity with the inverse (clockOut.ts) — keeps
 * the elapsed-minutes math co-located with the spec at the boundary.
 */
export function elapsedMinutesBetween(start: Timestamp, end: Timestamp): number {
  const ms = end.toMillis() - start.toMillis();
  return Math.max(0, Math.floor(ms / 60_000));
}
