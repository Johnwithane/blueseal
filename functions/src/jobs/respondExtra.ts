import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  extraId: z.string().min(1).max(128),
  accept: z.boolean(),
  declinedReason: z.string().trim().max(1000).default(""),
});

interface JobData {
  clientId: string;
  tradespersonId: string;
  chatId?: string;
  title?: string;
}

interface ExtraData {
  description: string;
  status: string;
  billingType: "flat" | "hourly";
  flatAmountCents: number | null;
  hourlyRateCents: number | null;
}

/**
 * Client approves or declines a proposed change order. Approving unlocks
 * clocking time against an hourly change order (and lets a flat one ride into
 * the final invoice). Declining records the reason. Only a "proposed" change
 * order can be responded to.
 */
export const respondExtra = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, extraId, accept, declinedReason } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const extraRef = jobRef.collection("extras").doc(extraId);

  const result = await db.runTransaction(async (tx) => {
    const [jobSnap, extraSnap] = await Promise.all([tx.get(jobRef), tx.get(extraRef)]);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;
    if (job.clientId !== uid) throw new HttpsError("permission-denied", "Not your job.");
    if (!extraSnap.exists) throw new HttpsError("not-found", "Change order not found.");
    const extra = extraSnap.data() as ExtraData;
    if (extra.status !== "proposed") {
      throw new HttpsError(
        "failed-precondition",
        `This change order is already ${extra.status}.`,
      );
    }

    tx.update(extraRef, {
      status: accept ? "approved" : "declined",
      decidedAt: FieldValue.serverTimestamp(),
      declinedReason: accept ? null : declinedReason,
    });

    return {
      tradespersonId: job.tradespersonId,
      chatId: job.chatId ?? null,
      title: (job.title ?? "the job").slice(0, 60),
      description: extra.description,
      billingType: extra.billingType,
      flatAmountCents: extra.flatAmountCents,
      hourlyRateCents: extra.hourlyRateCents,
    };
  });

  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const priceLabel =
    result.billingType === "hourly"
      ? `${dollars(result.hourlyRateCents ?? 0)}/hr`
      : dollars(result.flatAmountCents ?? 0);
  const verb = accept ? "approved" : "declined";

  if (result.chatId) {
    const reasonTail = !accept && declinedReason ? ` — "${declinedReason}"` : "";
    await postSystemMessage(
      result.chatId,
      `Client ${verb} the change order: ${result.description} (${priceLabel})${reasonTail}.`,
    );
  }

  await notify({
    userId: result.tradespersonId,
    type: accept ? "change_order_approved" : "change_order_declined",
    title: accept
      ? `Change order approved: ${result.title}`
      : `Change order declined: ${result.title}`,
    body: accept
      ? `"${result.description}" approved${result.billingType === "hourly" ? " — you can now clock time against it." : "."}`
      : declinedReason
        ? `"${result.description}" declined — "${declinedReason}"`
        : `"${result.description}" was declined.`,
    link: `/jobs/${jobId}?tab=workorder`,
    actorUid: uid,
    jobId,
    chatId: result.chatId,
    recipientRole: "tradesperson",
    priority: "high",
  });

  logger.info("respondExtra", { jobId, clientId: uid, extraId, accept });
  return { ok: true };
});
