import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  entryId: z.string().min(1).max(128),
});

/**
 * Close out an open time entry. Stamps `endedAt = serverTimestamp()` and
 * returns the elapsed minutes + billable cents so the UI can show an
 * immediate confirmation without re-fetching the doc.
 *
 * Idempotent-ish: a second clockOut on the same entry throws
 * failed-precondition rather than silently overwriting endedAt — useful
 * signal to the UI that the entry is already closed.
 */
export const clockOut = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);

  const { jobId, entryId } = parsed.data;
  const entryRef = db.doc(`jobs/${jobId}/timeEntries/${entryId}`);

  const { elapsedMinutes, billedAmount } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(entryRef);
    if (!snap.exists) throw new HttpsError("not-found", "Time entry not found.");
    const e = snap.data() as {
      tradespersonId: string;
      startedAt: Timestamp;
      endedAt: Timestamp | null;
      hourlyRateSnapshot: number;
    };
    if (e.tradespersonId !== uid) {
      throw new HttpsError("permission-denied", "Not your time entry.");
    }
    if (e.endedAt !== null) {
      throw new HttpsError("failed-precondition", "This session is already closed.");
    }
    const now = Timestamp.now();
    const elapsedMs = Math.max(0, now.toMillis() - e.startedAt.toMillis());
    const mins = Math.floor(elapsedMs / 60_000);
    const billed = Math.round((elapsedMs / 3_600_000) * e.hourlyRateSnapshot);
    tx.update(entryRef, { endedAt: FieldValue.serverTimestamp() });
    return { elapsedMinutes: mins, billedAmount: billed };
  });

  logger.info("clockOut", { jobId, entryId, tradespersonId: uid, elapsedMinutes, billedAmount });
  return { entryId, elapsedMinutes, billedAmount };
});
