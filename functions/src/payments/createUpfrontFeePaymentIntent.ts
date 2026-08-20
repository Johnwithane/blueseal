// Create (or refresh) the Stripe PaymentIntent for a job's upfront fee/deposit,
// called by the client from the upfront-fee pay screen. Symmetric to
// createInvoicePaymentIntent — upfront fees have no "send" step, so this is the
// only creation path. The Blue Seal service fee rides on application_fee_amount
// the same way; its platform portion counts against the SAME per-job $99 cap as
// the final invoice (so a job's two card payments never exceed $99 of platform
// fee combined). On success the webhook (handlers/upfrontFee.ts) flips the job
// to in_progress.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { getSubscriptionState } from "../lib/subscription";
import { assertTradieChargeable } from "./chargeable";
import { toStatementDescriptorSuffix } from "./statementDescriptor";
import { computeServiceFee } from "./serviceFee";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";

const Input = z.object({ jobId: z.string().min(1).max(128) });

interface UpfrontFeeData {
  amountCents: number;
  paidAt: unknown;
  payment?: {
    paymentIntentId?: string | null;
    clientSecret?: string | null;
    chargeId?: string | null;
    refundedAmount?: number;
    serviceFee?: unknown;
    lastWebhookEventId?: string | null;
    lastFailureMessage?: string | null;
  } | null;
}

interface JobData {
  tradespersonId: string;
  clientId: string | null;
  status: string;
  upfrontFee?: UpfrontFeeData | null;
  serviceFeeCapUsedCents?: number;
}

export const createUpfrontFeePaymentIntent = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireAuth(req);
    const parsed = Input.safeParse(req.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
    const { jobId } = parsed.data;

    const jobRef = db.doc(`jobs/${jobId}`);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;

    if (job.clientId !== uid) {
      throw new HttpsError("permission-denied", "This isn't your job to pay for.");
    }
    if (job.status !== "awaiting_upfront_payment") {
      throw new HttpsError(
        "failed-precondition",
        "This job isn't awaiting an upfront payment.",
      );
    }
    const fee = job.upfrontFee;
    if (!fee || !(fee.amountCents > 0)) {
      throw new HttpsError("failed-precondition", "No upfront fee on this job.");
    }
    if (fee.paidAt) {
      throw new HttpsError("failed-precondition", "The upfront fee is already paid.");
    }

    const { stripeAccountId, businessName } = await assertTradieChargeable(
      job.tradespersonId,
    );
    const statementSuffix = toStatementDescriptorSuffix(businessName);

    const { isPro: waived } = await getSubscriptionState(job.tradespersonId);
    const capUsedCents = job.serviceFeeCapUsedCents ?? 0;
    const serviceFee = computeServiceFee({
      baseAmountCents: fee.amountCents,
      waived,
      capUsedCents,
    });

    const stripe = getStripe();
    const metadata = {
      paymentType: "upfront_fee",
      jobId,
      tradespersonId: job.tradespersonId,
      clientId: job.clientId,
      baseAmountCents: String(serviceFee.baseAmountCents),
      platformFeeCents: String(serviceFee.platformPortionCents),
      processingFeeCents: String(serviceFee.processingPortionCents),
      feeModelVersion: String(serviceFee.feeModelVersion),
      waived: String(serviceFee.waived),
    };

    let paymentIntentId = fee.payment?.paymentIntentId ?? null;
    let clientSecret = fee.payment?.clientSecret ?? null;

    if (paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status === "succeeded" || pi.status === "processing") {
        return { clientSecret: pi.client_secret ?? clientSecret, serviceFee: snapshotOf(serviceFee) };
      }
      if (pi.amount !== serviceFee.chargeTotalCents) {
        const updated = await stripe.paymentIntents.update(paymentIntentId, {
          amount: serviceFee.chargeTotalCents,
          application_fee_amount: serviceFee.totalFeeCents,
          ...(statementSuffix ? { statement_descriptor_suffix: statementSuffix } : {}),
          metadata,
        });
        clientSecret = updated.client_secret ?? clientSecret;
      } else {
        clientSecret = pi.client_secret ?? clientSecret;
      }
    } else {
      const pi = await stripe.paymentIntents.create(
        {
          amount: serviceFee.chargeTotalCents,
          currency: "cad",
          application_fee_amount: serviceFee.totalFeeCents,
          transfer_data: { destination: stripeAccountId },
          automatic_payment_methods: { enabled: true },
          ...(statementSuffix ? { statement_descriptor_suffix: statementSuffix } : {}),
          description: `Blue Seal upfront fee — job ${jobId}`,
          metadata,
        },
        { idempotencyKey: `job:${jobId}:upfront:create:${serviceFee.chargeTotalCents}` },
      );
      paymentIntentId = pi.id;
      clientSecret = pi.client_secret ?? null;
    }

    // Targeted nested-field writes preserve the rest of upfrontFee.
    await jobRef.set(
      {
        upfrontFee: {
          payment: {
            paymentIntentId,
            clientSecret,
            chargeId: fee.payment?.chargeId ?? null,
            refundedAmount: fee.payment?.refundedAmount ?? 0,
            serviceFee: snapshotOf(serviceFee),
            lastWebhookEventId: fee.payment?.lastWebhookEventId ?? null,
            lastFailureMessage: fee.payment?.lastFailureMessage ?? null,
          },
        },
      },
      { merge: true },
    );

    return { clientSecret, serviceFee: snapshotOf(serviceFee) };
  },
);

function snapshotOf(fee: ReturnType<typeof computeServiceFee>) {
  return { ...fee, computedAt: Timestamp.now() };
}
