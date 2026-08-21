// Refund a card-paid invoice from inside Blue Seal.
//
// WHY THIS EXISTS: until now the only way to refund was the Stripe Dashboard,
// which meant a tradesperson couldn't do it at all. An unhappy client whose
// only visible option is their bank's dispute button will use it — and even a
// dispute Blue Seal WINS costs the per-dispute fee and pushes up the dispute
// ratio the card networks monitor. Making a refund the easy path is the
// cheapest chargeback mitigation available.
//
// Who bears what follows ToS § 8.1 and is computed in refundPlan.ts. The
// ordering below matters: on a partial refund the transfer reversal runs FIRST,
// so a tradesperson with no balance left fails before any money reaches the
// client rather than leaving Blue Seal short.
//
// This callable only INITIATES. The `charge.refunded` webhook is still what
// records the refund on the invoice, flips its status, and reverses rep/PM
// commission — so a refund issued from the Stripe Dashboard reconciles the
// same way as one issued here.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { isDisputeResolved, planRefund, type RefundRefusal } from "./refundPlan";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";
import { stripeFailure } from "./connectErrors";

const Input = z.object({
  invoiceId: z.string().min(1).max(128),
  // Omit for a full refund. Cents.
  amountCents: z.number().int().positive().max(100_000_000).optional(),
  reason: z.string().max(500).optional(),
});

const REFUSAL_MESSAGE: Record<RefundRefusal, (limit: number) => string> = {
  nothing_to_refund: () => "This payment has already been fully refunded.",
  amount_not_positive: () => "Enter a refund amount greater than zero.",
  exceeds_remaining: (limit) =>
    `That's more than the remaining balance on this payment (${fmt(limit)}).`,
  exceeds_tradesperson_share: (limit) =>
    `A partial refund comes out of your share of the payment, so it can't exceed ${fmt(limit)}. Refund the payment in full to also return the Blue Seal service fee to your client.`,
};

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface InvoiceData {
  tradespersonId: string;
  clientId: string | null;
  jobId: string;
  invoiceNumber: string;
  status: string;
  total: number;
  payment?: {
    paymentIntentId?: string | null;
    chargeId?: string | null;
    transferId?: string | null;
    refundedAmount?: number | null;
    disputeId?: string | null;
    disputeStatus?: string | null;
    serviceFee?: { chargeTotalCents?: number; baseAmountCents?: number } | null;
  } | null;
}

export const refundInvoicePayment = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireAuth(req);
    const parsed = Input.safeParse(req.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
    const { invoiceId, amountCents, reason } = parsed.data;
    const ctx = { fn: "refundInvoicePayment", uid, invoiceId };

    const invRef = db.doc(`invoices/${invoiceId}`);
    const invSnap = await invRef.get();
    if (!invSnap.exists) throw new HttpsError("not-found", "Invoice not found.");
    const inv = invSnap.data() as InvoiceData;

    // The tradesperson who was paid, or an admin acting on their behalf.
    // Accepts both the `roles: string[]` claim and the legacy singular `role`,
    // matching lib/auth.ts (kept local: editing lib/ forces a full ~200
    // function deploy, per .github/workflows/deploy.yml).
    const token = (req.auth?.token ?? {}) as { role?: unknown; roles?: unknown };
    const isAdmin =
      (Array.isArray(token.roles) && token.roles.includes("admin")) || token.role === "admin";
    if (inv.tradespersonId !== uid && !isAdmin) {
      throw new HttpsError("permission-denied", "Only the tradesperson paid can refund this.");
    }

    if (!["paid", "partially_refunded"].includes(inv.status)) {
      throw new HttpsError(
        "failed-precondition",
        `A ${inv.status} invoice can't be refunded.`,
      );
    }
    // A LIVE dispute is the bank's to decide; refunding alongside one can pay
    // the client twice. A resolved one must not block forever though: `disputeId`
    // stays set after closure, and a WON dispute returns the invoice to `paid`
    // with the tradesperson holding the money — they can still choose to refund.
    // (A lost dispute leaves the invoice `disputed`, so the status gate above
    // already covers it.)
    if (inv.payment?.disputeId && !isDisputeResolved(inv.payment.disputeStatus ?? null)) {
      throw new HttpsError(
        "failed-precondition",
        "This payment is under dispute — the outcome is decided by the client's bank, so it can't be refunded here.",
      );
    }
    const paymentIntentId = inv.payment?.paymentIntentId ?? null;
    if (!paymentIntentId) {
      throw new HttpsError(
        "failed-precondition",
        "This invoice wasn't paid by card, so there's nothing to refund here.",
      );
    }

    // The fee snapshot written at PaymentIntent creation is authoritative for
    // what the client paid vs what the tradesperson received. Fall back to the
    // invoice total for pre-snapshot invoices.
    const snapshot = inv.payment?.serviceFee ?? null;
    const baseAmountCents = snapshot?.baseAmountCents ?? inv.total;
    const chargeTotalCents = snapshot?.chargeTotalCents ?? inv.total;
    const alreadyRefundedCents = inv.payment?.refundedAmount ?? 0;

    const decision = planRefund({
      chargeTotalCents,
      baseAmountCents,
      alreadyRefundedCents,
      requestedCents: amountCents ?? null,
    });
    if (!decision.ok) {
      throw new HttpsError(
        "failed-precondition",
        REFUSAL_MESSAGE[decision.reason](decision.limitCents),
      );
    }
    const plan = decision.plan;

    const stripe = getStripe();
    logger.info("refundInvoicePayment: starting", { ...ctx, ...plan });

    try {
      // Partial refund: claw the tradesperson's share back BEFORE refunding, so
      // an empty connected account fails here rather than after the client has
      // been paid. See refundPlan.ts.
      if (plan.transferReversalCents > 0) {
        const charge = await stripe.charges.retrieve(
          inv.payment?.chargeId ?? (await resolveChargeId(stripe, paymentIntentId)),
        );
        const transferId =
          typeof charge.transfer === "string" ? charge.transfer : (charge.transfer?.id ?? null);
        if (!transferId) {
          throw new HttpsError(
            "failed-precondition",
            "Couldn't locate the payout behind this payment. Contact support and we'll sort it out.",
          );
        }
        await stripe.transfers.createReversal(
          transferId,
          {
            amount: plan.transferReversalCents,
            description: `Blue Seal partial refund — invoice ${inv.invoiceNumber}`,
            metadata: { invoiceId, refundedBy: uid },
          },
          {
            idempotencyKey: `invoice:${invoiceId}:refundReversal:${alreadyRefundedCents}:${plan.amountCents}`,
          },
        );
      }

      await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          amount: plan.amountCents,
          reverse_transfer: plan.reverseTransfer,
          refund_application_fee: plan.refundApplicationFee,
          metadata: {
            invoiceId,
            jobId: inv.jobId,
            refundedBy: uid,
            ...(reason ? { reason } : {}),
          },
        },
        {
          idempotencyKey: `invoice:${invoiceId}:refund:${alreadyRefundedCents}:${plan.amountCents}`,
        },
      );
    } catch (err) {
      throw stripeFailure(err, ctx);
    }

    await logAdminAction({
      actorUid: uid,
      action: plan.isFull ? "invoice_refunded_full" : "invoice_refunded_partial",
      targetType: "invoice",
      targetId: invoiceId,
      reason: reason ?? null,
      metadata: {
        amountCents: plan.amountCents,
        refundApplicationFee: plan.refundApplicationFee,
        byAdmin: isAdmin && inv.tradespersonId !== uid,
      },
    });

    logger.info("refundInvoicePayment: refund created", { ...ctx, amount: plan.amountCents });
    // The invoice doc is updated by the charge.refunded webhook, not here.
    return { ok: true, amountCents: plan.amountCents, isFull: plan.isFull };
  },
);

/** Charge id for a PaymentIntent, for invoices whose chargeId wasn't mirrored. */
async function resolveChargeId(
  stripe: ReturnType<typeof getStripe>,
  paymentIntentId: string,
): Promise<string> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  const latest = pi.latest_charge;
  const id = typeof latest === "string" ? latest : (latest?.id ?? null);
  if (!id) {
    throw new HttpsError("failed-precondition", "This payment hasn't settled yet.");
  }
  return id;
}
