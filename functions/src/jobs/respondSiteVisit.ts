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
  accept: z.boolean(),
  declinedReason: z.string().trim().max(1000).default(""),
});

interface JobData {
  clientId: string;
  tradespersonId: string;
  chatId?: string;
  title?: string;
}

interface SiteVisitData {
  status: string;
  fee: { description: string; feeCents: number; taxRate: number };
}

/**
 * Client agrees to (or declines) a proposed site visit. One tap, no signature —
 * it's an agreement to a visit, not a work contract; the signature stays on the
 * real quote later. Agreeing leaves the fee on jobs/{jobId}/siteVisit/current so
 * the tradesperson's quote composer pre-fills it. Only a "proposed" visit can be
 * responded to. Does not change the job status.
 */
export const respondSiteVisit = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, accept, declinedReason } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const visitRef = jobRef.collection("siteVisit").doc("current");

  const result = await db.runTransaction(async (tx) => {
    const [jobSnap, visitSnap] = await Promise.all([tx.get(jobRef), tx.get(visitRef)]);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;
    if (job.clientId !== uid) throw new HttpsError("permission-denied", "Not your job.");
    if (!visitSnap.exists) throw new HttpsError("not-found", "Site visit request not found.");
    const visit = visitSnap.data() as SiteVisitData;
    if (visit.status !== "proposed") {
      throw new HttpsError("failed-precondition", `This site visit is already ${visit.status}.`);
    }

    tx.update(visitRef, {
      status: accept ? "agreed" : "declined",
      decidedAt: FieldValue.serverTimestamp(),
      declinedReason: accept ? null : declinedReason,
    });

    return {
      tradespersonId: job.tradespersonId,
      chatId: job.chatId ?? null,
      title: (job.title ?? "the job").slice(0, 60),
      feeCents: visit.fee.feeCents,
    };
  });

  const feeLabel =
    result.feeCents === 0
      ? "a free site visit"
      : `a site visit ($${(result.feeCents / 100).toFixed(2)})`;
  const verb = accept ? "agreed to" : "declined";

  if (result.chatId) {
    const reasonTail = !accept && declinedReason ? ` — "${declinedReason}"` : "";
    await postSystemMessage(
      result.chatId,
      `Client ${verb} ${feeLabel} before quoting${reasonTail}.`,
    );
  }

  await notify({
    userId: result.tradespersonId,
    type: accept ? "site_visit_agreed" : "site_visit_declined",
    title: accept
      ? `Site visit agreed: ${result.title}`
      : `Site visit declined: ${result.title}`,
    body: accept
      ? "The client agreed to the visit — the fee will be pre-filled into your quote."
      : declinedReason
        ? `The client declined the visit — "${declinedReason}"`
        : "The client declined the site visit.",
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId,
    recipientRole: "tradesperson",
    priority: "high",
  });

  logger.info("respondSiteVisit", { jobId, clientId: uid, accept });
  return { ok: true };
});
