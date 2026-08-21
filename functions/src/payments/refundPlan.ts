/**
 * Refund arithmetic — pure, so who-pays-what is pinned by tests rather than
 * discovered on a live invoice.
 *
 * WHO BEARS A REFUND (ToS § 8.1)
 *   Full refund     — the client gets everything back, including the Blue Seal
 *                     service fee. The tradesperson returns their share, Blue
 *                     Seal returns the fee.
 *   Partial refund  — the refunded amount comes from the TRADESPERSON's side.
 *                     The service fee stays with Blue Seal (the client paid it
 *                     for a card payment that was in fact performed).
 *
 * WHY THE PLAN CARRIES AN EXPLICIT TRANSFER REVERSAL
 * Stripe's `reverse_transfer: true` unwinds the transfer *proportionally* to
 * the refunded amount. On a full refund that's exactly right. On a partial
 * refund it is not: it would pull only `amount × base/chargeTotal` back from
 * the tradesperson and leave Blue Seal funding the remaining fee slice out of
 * pocket — the opposite of what § 8.1 says. So a partial refund reverses the
 * transfer explicitly, for the full refunded amount, and asks Stripe to reverse
 * nothing on its own.
 *
 * The caller must apply the plan in this order: reverse the transfer FIRST,
 * then create the refund. A reversal that fails (the tradesperson has already
 * been paid out and has no balance) must abort before any money reaches the
 * client, or Blue Seal is left short.
 */

/**
 * Stripe dispute statuses that mean the bank has finished deciding. Mirrored in
 * src/components/RefundInvoiceCard.vue — a live dispute blocks a refund, a
 * resolved one must not block it forever (`payment.disputeId` stays set after
 * closure).
 */
export const RESOLVED_DISPUTE_STATUSES = ["won", "lost", "warning_closed"];

export function isDisputeResolved(disputeStatus: string | null): boolean {
  return disputeStatus !== null && RESOLVED_DISPUTE_STATUSES.includes(disputeStatus);
}

export interface RefundPlan {
  /** Cents to refund to the client. */
  amountCents: number;
  /** True when this refund settles the entire remaining charge. */
  isFull: boolean;
  /** Ask Stripe to reverse the transfer proportionally (full refunds only). */
  reverseTransfer: boolean;
  /** Return the Blue Seal service fee to the client (full refunds only). */
  refundApplicationFee: boolean;
  /**
   * Cents to pull back from the connected account BEFORE refunding. Zero on a
   * full refund, where `reverseTransfer` covers it.
   */
  transferReversalCents: number;
}

export type RefundRefusal =
  | "nothing_to_refund"
  | "amount_not_positive"
  | "exceeds_remaining"
  | "exceeds_tradesperson_share";

export type RefundDecision =
  | { ok: true; plan: RefundPlan }
  | { ok: false; reason: RefundRefusal; limitCents: number };

/**
 * @param chargeTotalCents      what the client actually paid (invoice + fee)
 * @param baseAmountCents       what the tradesperson received (invoice total)
 * @param alreadyRefundedCents  cents already refunded on this charge
 * @param requestedCents        null = refund everything remaining
 */
export function planRefund(input: {
  chargeTotalCents: number;
  baseAmountCents: number;
  alreadyRefundedCents: number;
  requestedCents: number | null;
}): RefundDecision {
  const { chargeTotalCents, baseAmountCents, alreadyRefundedCents, requestedCents } = input;

  const remaining = chargeTotalCents - alreadyRefundedCents;
  if (remaining <= 0) return { ok: false, reason: "nothing_to_refund", limitCents: 0 };

  // A full refund settles whatever is left of the charge — including the case
  // where the caller names an amount that happens to cover it.
  if (requestedCents === null || requestedCents >= remaining) {
    return {
      ok: true,
      plan: {
        amountCents: remaining,
        isFull: true,
        reverseTransfer: true,
        refundApplicationFee: true,
        transferReversalCents: 0,
      },
    };
  }

  if (!Number.isInteger(requestedCents) || requestedCents <= 0) {
    return { ok: false, reason: "amount_not_positive", limitCents: remaining };
  }
  if (requestedCents > remaining) {
    return { ok: false, reason: "exceeds_remaining", limitCents: remaining };
  }

  // A partial refund comes out of the tradesperson's share, so it can't exceed
  // what they actually received net of anything already clawed back.
  const tradieShareRemaining = Math.max(0, baseAmountCents - alreadyRefundedCents);
  if (requestedCents > tradieShareRemaining) {
    return { ok: false, reason: "exceeds_tradesperson_share", limitCents: tradieShareRemaining };
  }

  return {
    ok: true,
    plan: {
      amountCents: requestedCents,
      isFull: false,
      reverseTransfer: false,
      refundApplicationFee: false,
      transferReversalCents: requestedCents,
    },
  };
}
