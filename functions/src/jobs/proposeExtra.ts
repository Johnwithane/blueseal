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
  description: z.string().trim().min(1).max(200),
  billingType: z.enum(["flat", "hourly"]),
  // For "flat": the one-off amount in cents. For "hourly": the rate in cents/hr.
  amountCents: z.number().int().min(1).max(100_000_000),
  // Optional ballpark for hourly change orders (display-only — the invoice
  // bills actual clocked time). Ignored for flat.
  estimatedHours: z.number().min(0).max(10_000).nullable().optional(),
});

interface JobData {
  clientId: string | null;
  tradespersonId: string;
  status: string;
  chatId?: string;
  title?: string;
}

/**
 * Tradesperson proposes a "change order" — an out-of-scope charge added after
 * work starts (not part of the original quote). It lands in status "proposed";
 * the client approves/declines it up front via respondExtra, and only an
 * approved hourly change order can have time clocked against it (clockIn). This
 * is the only way hourly money enters a fixed-price job.
 *
 * Stored at jobs/{jobId}/extras/{extraId}. Server-managed (admin SDK) so the
 * rules can deny party writes and approval state can't be forged.
 */
export const proposeExtra = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, description, billingType, amountCents } = parsed.data;
  const estimatedHours =
    billingType === "hourly" && (parsed.data.estimatedHours ?? 0) > 0
      ? parsed.data.estimatedHours!
      : null;

  const jobRef = db.doc(`jobs/${jobId}`);
  const extraRef = jobRef.collection("extras").doc();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = snap.data() as JobData;
    if (job.tradespersonId !== uid) throw new HttpsError("permission-denied", "Not your job.");
    if (job.status !== "in_progress") {
      throw new HttpsError(
        "failed-precondition",
        "Change orders can only be added once the job is in progress.",
      );
    }
    // Solo (unclaimed invite) jobs: there's no client to approve a change
    // order, so a proposal would stall pending forever. Out-of-scope work on
    // a solo job bills via a custom line item on the invoice instead.
    if (job.clientId === null) {
      throw new HttpsError(
        "failed-precondition",
        "This job has no client on Blue Seal yet — add extra work as an invoice line item instead.",
      );
    }

    tx.set(extraRef, {
      tradespersonId: uid,
      clientId: job.clientId,
      description,
      billingType,
      flatAmountCents: billingType === "flat" ? amountCents : null,
      hourlyRateCents: billingType === "hourly" ? amountCents : null,
      estimatedHours,
      status: "proposed",
      proposedAt: FieldValue.serverTimestamp(),
      decidedAt: null,
      declinedReason: null,
      invoicedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      clientId: job.clientId,
      chatId: job.chatId ?? null,
      title: (job.title ?? "the job").slice(0, 60),
    };
  });

  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const priceLabel =
    billingType === "hourly"
      ? `${dollars(amountCents)}/hr${estimatedHours ? ` (~${estimatedHours}h est.)` : ""}`
      : dollars(amountCents);

  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Tradesperson proposed a change order: ${description} (${priceLabel}). Awaiting your approval.`,
    );
  }

  await notify({
    userId: result.clientId,
    type: "change_order_proposed",
    title: `New change order: ${result.title}`,
    body: `${description} — ${priceLabel}. Open the job to approve or decline.`,
    link: `/jobs/${jobId}?tab=workorder`,
    actorUid: uid,
    jobId,
    chatId: result.chatId,
    recipientRole: "client",
    // Link to the change order so a later withdraw can resolve this exact row.
    relatedId: extraRef.id,
    // The tradie may be waiting to start this work — page the client.
    priority: "high",
  });

  logger.info("proposeExtra", { jobId, tradespersonId: uid, extraId: extraRef.id, billingType });
  return { ok: true, extraId: extraRef.id };
});
