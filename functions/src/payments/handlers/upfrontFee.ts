// Webhook handlers for upfront-fee PaymentIntents (metadata.paymentType ===
// "upfront_fee"). Mirrors the invoice paymentIntent handlers but operates on a
// job's upfrontFee.payment sub-state instead of an invoice.
//
//   succeeded  → job awaiting_upfront_payment → in_progress; upfrontFee marked
//                paid (paidBy "stripe"), platform portion banked against the
//                per-job $99 cap. If the upfront was already marked paid offline
//                (manual-mark race) the status flip is skipped, but the charge
//                is recorded and the cap still banked (real money moved).
//   processing → record chargeId; job stays awaiting (banner shows "confirming").
//   failed     → stamp the failure message; notify the client.
//   canceled   → clear the stale intent so a retry mints a fresh one.

import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../../lib/admin";
import { postSystemMessage } from "../../lib/chatSystemMessage";
import { notify } from "../../lib/notify";
import type { StripePaymentIntent } from "./shared";

interface JobUpfrontLookup {
  ref: DocumentReference;
  data: {
    tradespersonId?: string;
    clientId?: string;
    status?: string;
    chatId?: string;
    upfrontFee?: {
      amountCents?: number;
      paidAt?: unknown;
      payment?: {
        lastWebhookEventId?: string | null;
        serviceFee?: { platformPortionCents?: number; chargeTotalCents?: number } | null;
      } | null;
    } | null;
  };
}

async function findJob(pi: StripePaymentIntent): Promise<JobUpfrontLookup | null> {
  const jobId = pi.metadata?.jobId;
  if (jobId) {
    const ref = db.doc(`jobs/${jobId}`);
    const snap = await ref.get();
    if (snap.exists) return { ref, data: snap.data() ?? {} };
    logger.warn("upfrontFee handler: metadata jobId missing doc", { paymentIntentId: pi.id, jobId });
  }
  const q = await db
    .collection("jobs")
    .where("upfrontFee.payment.paymentIntentId", "==", pi.id)
    .limit(1)
    .get();
  if (q.empty) {
    logger.warn("upfrontFee handler: no job for PaymentIntent", { paymentIntentId: pi.id });
    return null;
  }
  return { ref: q.docs[0].ref, data: q.docs[0].data() };
}

function chargeId(pi: StripePaymentIntent): string | null {
  const lc = pi.latest_charge;
  if (!lc) return null;
  return typeof lc === "string" ? lc : (lc.id ?? null);
}

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

export async function handleUpfrontFeeProcessing(
  pi: StripePaymentIntent,
  eventId: string,
): Promise<void> {
  const job = await findJob(pi);
  if (!job) return;
  await job.ref.set(
    { upfrontFee: { payment: { chargeId: chargeId(pi), lastWebhookEventId: eventId } } },
    { merge: true },
  );
}

export async function handleUpfrontFeeSucceeded(
  pi: StripePaymentIntent,
  eventId: string,
): Promise<void> {
  const job = await findJob(pi);
  if (!job) return;

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(job.ref);
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const upfront = (data.upfrontFee ?? {}) as JobUpfrontLookup["data"]["upfrontFee"];
    if (upfront?.payment?.lastWebhookEventId === eventId) return null;

    const platform = upfront?.payment?.serviceFee?.platformPortionCents ?? 0;
    const capInc = platform > 0 ? { serviceFeeCapUsedCents: FieldValue.increment(platform) } : {};

    // Manual-mark race: the tradesperson already marked the upfront paid
    // offline before the card payment settled. Don't re-flip the status, but
    // record the charge + bank the cap (real money moved) and flag for review.
    if (upfront?.paidAt) {
      logger.error("upfrontFee succeeded after offline mark — double payment, admin review", {
        jobId: job.ref.id,
        paymentIntentId: pi.id,
      });
      tx.set(
        job.ref,
        {
          ...capInc,
          upfrontFee: { payment: { chargeId: chargeId(pi), lastWebhookEventId: eventId } },
        },
        { merge: true },
      );
      return { flipped: false as const };
    }

    tx.update(job.ref, {
      status: "in_progress",
      "upfrontFee.paidAt": FieldValue.serverTimestamp(),
      "upfrontFee.paidBy": "stripe",
      "upfrontFee.paymentMethod": "stripe",
      "upfrontFee.payment.chargeId": chargeId(pi),
      "upfrontFee.payment.lastWebhookEventId": eventId,
      ...capInc,
    });
    return {
      flipped: true as const,
      tradespersonId: (data.tradespersonId as string) ?? "",
      clientId: (data.clientId as string) ?? "",
      chatId: (data.chatId as string) ?? "",
      amountCents: upfront?.amountCents ?? 0,
      chargeTotalCents: upfront?.payment?.serviceFee?.chargeTotalCents ?? upfront?.amountCents ?? 0,
    };
  });

  if (!result || !result.flipped) return;

  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Upfront fee paid by card (${fmtMoney(result.amountCents)}). Job is now active — it'll be credited against the final invoice.`,
    );
  }
  await Promise.all([
    notify({
      userId: result.tradespersonId,
      type: "invoice_paid",
      title: "Upfront fee paid",
      body: `${fmtMoney(result.amountCents)} received by card. Job is active — work can start.`,
      link: `/jobs/${job.ref.id}`,
      actorUid: result.clientId,
      jobId: job.ref.id,
      chatId: result.chatId || null,
      recipientRole: "tradesperson",
      priority: "high",
    }),
    notify({
      userId: result.clientId,
      type: "invoice_paid",
      title: "Upfront fee paid",
      body: `Thanks — your ${fmtMoney(result.chargeTotalCents)} payment cleared and work can begin.`,
      link: `/jobs/${job.ref.id}`,
      actorUid: result.tradespersonId,
      jobId: job.ref.id,
      chatId: result.chatId || null,
      recipientRole: "client",
      priority: "low",
    }),
  ]);
}

export async function handleUpfrontFeeFailed(
  pi: StripePaymentIntent,
  eventId: string,
): Promise<void> {
  const job = await findJob(pi);
  if (!job) return;
  const upfront = job.data.upfrontFee;
  if (upfront?.payment?.lastWebhookEventId === eventId) return;
  const message = pi.last_payment_error?.message ?? "Payment attempt failed.";
  await job.ref.set(
    { upfrontFee: { payment: { lastWebhookEventId: eventId, lastFailureMessage: message } } },
    { merge: true },
  );
  await notify({
    userId: job.data.clientId ?? null,
    type: "invoice_payment_failed",
    title: "Upfront payment failed",
    body: message,
    link: `/jobs/${job.ref.id}`,
    actorUid: job.data.tradespersonId ?? null,
    recipientRole: "client",
    priority: "high",
  });
}

export async function handleUpfrontFeeCanceled(
  pi: StripePaymentIntent,
  eventId: string,
): Promise<void> {
  const job = await findJob(pi);
  if (!job) return;
  const upfront = job.data.upfrontFee;
  if (upfront?.payment?.lastWebhookEventId === eventId) return;
  if (upfront?.paidAt) return; // already paid — ignore a late cancel
  await job.ref.set(
    {
      upfrontFee: {
        payment: { paymentIntentId: null, clientSecret: null, lastWebhookEventId: eventId },
      },
    },
    { merge: true },
  );
}
