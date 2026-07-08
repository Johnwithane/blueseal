import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  extraId: z.string().min(1).max(128),
});

interface JobData {
  tradespersonId: string;
  chatId?: string;
}

interface ExtraData {
  description: string;
  status: string;
  invoicedAt: unknown;
}

/**
 * Tradesperson withdraws a change order they proposed (or an approved one they
 * no longer intend to bill). Only allowed while it hasn't been invoiced. Time
 * entries already clocked against an hourly change order are left untouched —
 * they keep their frozen rate; cancelling just stops it being offered/clocked.
 */
export const cancelExtra = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, extraId } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const extraRef = jobRef.collection("extras").doc(extraId);

  const result = await db.runTransaction(async (tx) => {
    const [jobSnap, extraSnap] = await Promise.all([tx.get(jobRef), tx.get(extraRef)]);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;
    if (job.tradespersonId !== uid) throw new HttpsError("permission-denied", "Not your job.");
    if (!extraSnap.exists) throw new HttpsError("not-found", "Change order not found.");
    const extra = extraSnap.data() as ExtraData;
    if (extra.invoicedAt != null) {
      throw new HttpsError("failed-precondition", "This change order has already been invoiced.");
    }
    if (extra.status === "cancelled" || extra.status === "declined") {
      throw new HttpsError("failed-precondition", `This change order is already ${extra.status}.`);
    }

    tx.update(extraRef, { status: "cancelled", decidedAt: FieldValue.serverTimestamp() });
    return { chatId: job.chatId ?? null, description: extra.description };
  });

  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Tradesperson withdrew the change order: ${result.description}.`,
    );
  }

  // Resolve the client's now-stale "New change order — approve or decline"
  // notification so the bell stops offering a withdrawn CO as actionable
  // (P2-18). Keyed on relatedId (the extraId, a globally-unique auto-id), so a
  // single-field query is enough — no composite index. Best-effort.
  try {
    const stale = await db
      .collection("notifications")
      .where("relatedId", "==", extraId)
      .get();
    if (!stale.empty) {
      const batch = db.batch();
      stale.docs.forEach((d) =>
        batch.update(d.ref, { read: true, readAt: FieldValue.serverTimestamp() }),
      );
      await batch.commit();
    }
  } catch (err) {
    logger.warn("cancelExtra: could not resolve stale CO notification", { jobId, extraId, err });
  }

  logger.info("cancelExtra", { jobId, tradespersonId: uid, extraId });
  return { ok: true };
});
