// Create (or refresh) the Stripe PaymentIntent for an invoice — at PAY time,
// called by the client from InvoicePayView, not at send time. Pay-time creation
// is deliberate:
//   - the Blue Seal service fee + the Pro waiver are evaluated against the LIVE
//     invoice total, so an invoice edited after sending can't drift from the
//     amount the client is charged;
//   - the per-job $99 fee cap is read fresh (an upfront payment may have used
//     part of it);
//   - it mirrors the upfront-fee path (which has no "send" step) so both card
//     payments share one shape.
//
// The tradesperson nets the full invoice total: this is a destination charge
// (transfer_data.destination + application_fee_amount), so the connected
// account receives amount − fee = invoice.total exactly, and the client's
// charge covers the platform fee + Stripe's processing via the gross-up in
// computeServiceFee. See functions/src/payments/serviceFee.ts.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { getSubscriptionState } from "../lib/subscription";
import { assertTradieChargeable } from "./chargeable";
import { computeServiceFee } from "./serviceFee";
import { threeDSecurePreference } from "./paymentRisk";
import { toStatementDescriptorSuffix } from "./statementDescriptor";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";

const Input = z.object({ invoiceId: z.string().min(1).max(128) });

interface InvoiceData {
  tradespersonId: string;
  clientId: string | null;
  jobId: string;
  invoiceNumber: string;
  status: string;
  total: number;
  currency: string;
  payment?: {
    paymentIntentId?: string | null;
    clientSecret?: string | null;
    chargeId?: string | null;
    serviceFee?: unknown;
    transferId?: string | null;
    transferDestination?: string | null;
    refundedAmount?: number | null;
    refunds?: unknown[] | null;
    disputeId?: string | null;
    disputeStatus?: string | null;
    lastWebhookEventId?: string | null;
  } | null;
}

export const createInvoicePaymentIntent = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireAuth(req);
    const parsed = Input.safeParse(req.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
    const { invoiceId } = parsed.data;

    const invRef = db.doc(`invoices/${invoiceId}`);
    const invSnap = await invRef.get();
    if (!invSnap.exists) throw new HttpsError("not-found", "Invoice not found.");
    const inv = invSnap.data() as InvoiceData;

    // Only the billed client can create the payment.
    if (inv.clientId !== uid) {
      throw new HttpsError("permission-denied", "This invoice isn't yours to pay.");
    }
    if (!["sent", "viewed", "overdue"].includes(inv.status)) {
      throw new HttpsError(
        "failed-precondition",
        `This invoice can't be paid in status "${inv.status}".`,
      );
    }
    if (!(inv.total > 0)) {
      throw new HttpsError("failed-precondition", "This invoice has nothing due.");
    }
    // The fee constants are CAD; refuse anything else rather than mis-charge.
    if ((inv.currency ?? "CAD").toUpperCase() !== "CAD") {
      throw new HttpsError("failed-precondition", "Online payment is only available in CAD.");
    }

    // Tradesperson must be able to receive a destination charge of this size:
    // onboarding complete, card payments not paused, amount within their
    // ceiling. See chargeable.ts.
    const { stripeAccountId, businessName } = await assertTradieChargeable(
      inv.tradespersonId,
      inv.total,
    );
    // "BLUESEAL* SMITH ELECTRIC" beats a bare "BLUESEAL" the client never
    // hired. Omitted entirely when the name yields nothing Stripe-safe.
    const statementSuffix = toStatementDescriptorSuffix(businessName);

    // Pro waiver (the tradesperson being Pro waives their clients' platform
    // fee) + the per-job cap already consumed by an upfront payment.
    const { isPro: waived } = await getSubscriptionState(inv.tradespersonId);
    const jobSnap = await db.doc(`jobs/${inv.jobId}`).get();
    const capUsedCents = (jobSnap.data()?.serviceFeeCapUsedCents as number | undefined) ?? 0;

    const fee = computeServiceFee({ baseAmountCents: inv.total, waived, capUsedCents });

    const stripe = getStripe();
    const metadata = {
      paymentType: "invoice",
      invoiceId,
      jobId: inv.jobId,
      tradespersonId: inv.tradespersonId,
      clientId: inv.clientId,
      invoiceNumber: inv.invoiceNumber,
      baseAmountCents: String(fee.baseAmountCents),
      platformFeeCents: String(fee.platformPortionCents),
      processingFeeCents: String(fee.processingPortionCents),
      feeModelVersion: String(fee.feeModelVersion),
      waived: String(fee.waived),
    };

    // 3-D Secure is the only lever that actually moves fraud-chargeback
    // liability off Blue Seal and onto the card issuer, so we ask for it on
    // every payment and insist above the threshold. See paymentRisk.ts.
    const paymentMethodOptions = {
      card: { request_three_d_secure: threeDSecurePreference(fee.chargeTotalCents) },
    } as const;

    let paymentIntentId = inv.payment?.paymentIntentId ?? null;
    let clientSecret = inv.payment?.clientSecret ?? null;

    if (paymentIntentId) {
      // Reuse or refresh the existing intent.
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status === "succeeded" || pi.status === "processing") {
        // Already paying / paid — hand back the existing secret unchanged.
        return { clientSecret: pi.client_secret ?? clientSecret, serviceFee: snapshotOf(fee) };
      }
      if (pi.amount !== fee.chargeTotalCents) {
        // Invoice was edited, Pro state changed, or the cap moved — re-price.
        const updated = await stripe.paymentIntents.update(paymentIntentId, {
          amount: fee.chargeTotalCents,
          application_fee_amount: fee.totalFeeCents,
          // Re-priced intents cross the 3DS threshold in both directions, so
          // the preference is recomputed here rather than left at whatever the
          // original amount implied.
          payment_method_options: paymentMethodOptions,
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
          amount: fee.chargeTotalCents,
          currency: "cad",
          application_fee_amount: fee.totalFeeCents,
          transfer_data: { destination: stripeAccountId },
          automatic_payment_methods: { enabled: true },
          payment_method_options: paymentMethodOptions,
          ...(statementSuffix ? { statement_descriptor_suffix: statementSuffix } : {}),
          description: `Blue Seal invoice ${inv.invoiceNumber}`,
          metadata,
        },
        // Embed the amount so a legitimately re-priced intent within Stripe's
        // 24h idempotency window isn't rejected for same-key/different-params.
        { idempotencyKey: `invoice:${invoiceId}:create:${fee.chargeTotalCents}` },
      );
      paymentIntentId = pi.id;
      clientSecret = pi.client_secret ?? null;
    }

    // Merge-write the payment state (server-managed; rules lock `payment`).
    // Preserve any prior refund/dispute fields.
    await invRef.set(
      {
        payment: {
          paymentIntentId,
          clientSecret,
          chargeId: inv.payment?.chargeId ?? null,
          serviceFee: snapshotOf(fee),
          transferId: inv.payment?.transferId ?? null,
          transferDestination: stripeAccountId,
          refundedAmount: inv.payment?.refundedAmount ?? 0,
          refunds: inv.payment?.refunds ?? [],
          disputeId: inv.payment?.disputeId ?? null,
          disputeStatus: inv.payment?.disputeStatus ?? null,
          lastWebhookEventId: inv.payment?.lastWebhookEventId ?? null,
        },
      },
      { merge: true },
    );

    return { clientSecret, serviceFee: snapshotOf(fee) };
  },
);

function snapshotOf(fee: ReturnType<typeof computeServiceFee>) {
  return { ...fee, computedAt: Timestamp.now() };
}
