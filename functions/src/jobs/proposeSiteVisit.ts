import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";
import { SiteVisitFeeSchema } from "../lib/quoteSchemas";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  fee: SiteVisitFeeSchema,
  proposedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  note: z.string().trim().max(500).default(""),
});

interface JobData {
  clientId: string | null;
  tradespersonId: string;
  status: string;
  chatId?: string;
  title?: string;
}

interface SiteVisitData {
  status: string;
}

/**
 * Tradesperson asks for a site visit BEFORE quoting — instead of, or before,
 * sending a firm quote. Optionally charges a single fee for the visit (feeCents
 * 0 = free). It lands in status "proposed"; the client agrees with one tap
 * (respondSiteVisit) — no signature, since it isn't a work contract.
 *
 * Deliberately does NOT change the job status: the job stays "requested"/"quoted"
 * and the agreement is recorded on the side. When the tradesperson later opens
 * the quote composer, an "agreed" visit fee is pre-filled as a line item.
 *
 * Stored at jobs/{jobId}/siteVisit/current (one per job). Server-managed (admin
 * SDK) so rules can deny party writes and "agreed" can't be forged.
 */
export const proposeSiteVisit = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, fee, proposedDate, note } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const visitRef = jobRef.collection("siteVisit").doc("current");

  const proposedTs = proposedDate
    ? Timestamp.fromDate(new Date(`${proposedDate}T00:00:00Z`))
    : null;

  const result = await db.runTransaction(async (tx) => {
    const [jobSnap, visitSnap] = await Promise.all([tx.get(jobRef), tx.get(visitRef)]);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;
    if (job.tradespersonId !== uid) throw new HttpsError("permission-denied", "Not your job.");
    if (job.status !== "requested" && job.status !== "quoted") {
      throw new HttpsError(
        "failed-precondition",
        "A site visit can only be requested before the quote is accepted.",
      );
    }
    // Solo (unclaimed invite) jobs: there's no client to agree to the visit —
    // the tradesperson arranges it with their own client directly.
    if (job.clientId === null) {
      throw new HttpsError(
        "failed-precondition",
        "This job has no client on Blue Seal yet — arrange the visit with your client directly.",
      );
    }
    // Re-proposing is fine from absent/proposed/declined, but never wipe an
    // agreement the client already gave.
    if (visitSnap.exists && (visitSnap.data() as SiteVisitData).status === "agreed") {
      throw new HttpsError(
        "failed-precondition",
        "The client has already agreed to a site visit.",
      );
    }

    tx.set(visitRef, {
      tradespersonId: uid,
      clientId: job.clientId,
      fee,
      proposedDate: proposedTs,
      note,
      status: "proposed",
      proposedAt: FieldValue.serverTimestamp(),
      decidedAt: null,
      declinedReason: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      clientId: job.clientId,
      chatId: job.chatId ?? null,
      title: (job.title ?? "the job").slice(0, 60),
    };
  });

  const feeLabel =
    fee.feeCents === 0 ? "a free site visit" : `a site visit — $${(fee.feeCents / 100).toFixed(2)}`;

  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Tradesperson is requesting ${feeLabel} before quoting. Awaiting your agreement.`,
    );
  }

  await notify({
    userId: result.clientId,
    type: "site_visit_proposed",
    title: `Site visit requested: ${result.title}`,
    body: `Your tradesperson would like ${feeLabel} before quoting. Open the job to agree or decline.`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId,
    recipientRole: "client",
    // The tradie is waiting on this before they can quote — page the client.
    priority: "high",
  });

  logger.info("proposeSiteVisit", { jobId, tradespersonId: uid, feeCents: fee.feeCents });
  return { ok: true };
});
