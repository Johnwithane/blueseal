// Dispute fund recovery — the mechanics behind ToS § 8.4 ("Payment Losses").
//
// WHY THIS EXISTS
// We take DESTINATION charges (transfer_data.destination), which makes Blue
// Seal the merchant of record. When a client charges back, the card network
// debits the PLATFORM balance for the disputed amount plus Stripe's per-dispute
// fee — it does not touch the connected account. Without this module the
// tradesperson keeps their payout and Blue Seal eats the loss, which is exactly
// backwards from how the Terms allocate it.
//
// So on `charge.dispute.created` we reverse the transfer that funded the
// tradesperson, pulling those cents back to the platform balance while the
// dispute is decided. The 7-day payout hold (connectAccount.ts PAYOUT_HOLD_DAYS)
// exists precisely so the money is usually still sitting in the connected
// account when this runs.
//
// If the dispute is WON, the funds are ours to give back: we re-transfer the
// reversed amount so the tradesperson is made whole. If it is LOST, the money
// stays clawed back — the tradesperson absorbed it, per ToS § 8.2.
//
// FAILURE IS NOT SILENT. A reversal can fail (the connected account already
// paid out and has no balance). We record that on the dispute doc as
// `recovery.status = "failed"` so the admin queue can surface a real debt to
// chase, rather than the loss quietly landing on Blue Seal.

import { logger } from "firebase-functions/v2";

import type { StripeClient } from "./stripeClient";
import { stripeErrorInfo } from "./connectErrors";

/**
 * How many cents to claw back from the tradesperson's transfer.
 *
 * The disputed amount is the FULL charge the client paid — invoice total plus
 * the Blue Seal service fee. The transfer only ever carried the invoice total
 * (the fee was retained as an application fee), so the tradesperson can never
 * owe back more than the transfer itself. Clamping here rather than letting
 * Stripe reject the call keeps a $2 fee difference from failing the whole
 * recovery.
 *
 * Pure so the clamping rules are pinned by unit tests.
 */
export function computeReversalCents(input: {
  disputeAmountCents: number;
  transferAmountCents: number;
  alreadyReversedCents: number;
}): number {
  const { disputeAmountCents, transferAmountCents, alreadyReversedCents } = input;
  const reversible = Math.max(0, transferAmountCents - alreadyReversedCents);
  return Math.max(0, Math.min(disputeAmountCents, reversible));
}

export interface RecoveryOutcome {
  status: "reversed" | "nothing_to_reverse" | "failed";
  transferId: string | null;
  reversalId: string | null;
  reversedCents: number;
  /**
   * The connected account the reversed funds came from. Recorded at reversal
   * time so a later WIN can transfer them back without re-deriving the
   * destination from an invoice that may since have been edited.
   */
  destinationAccountId: string | null;
  failureMessage: string | null;
}

/**
 * Pull the tradesperson's share of a disputed charge back to the platform
 * balance. Idempotent: Stripe's idempotency key is derived from the dispute id,
 * so a replayed webhook returns the original reversal instead of double-pulling.
 */
export async function reverseTransferForDispute(
  stripe: StripeClient,
  input: { disputeId: string; chargeId: string; disputeAmountCents: number },
): Promise<RecoveryOutcome> {
  const ctx = { disputeId: input.disputeId, chargeId: input.chargeId };
  const empty: RecoveryOutcome = {
    status: "nothing_to_reverse",
    transferId: null,
    reversalId: null,
    reversedCents: 0,
    destinationAccountId: null,
    failureMessage: null,
  };

  try {
    // Read the transfer off the charge rather than trusting our mirrored
    // `payment.transferId`: the charge is Stripe's own record of where the
    // money went, and it is correct even for invoices written before we
    // started stamping the transfer id.
    const charge = await stripe.charges.retrieve(input.chargeId);
    const transferId =
      typeof charge.transfer === "string" ? charge.transfer : (charge.transfer?.id ?? null);

    if (!transferId) {
      // No transfer means no connected-account money to claw back — an
      // unlikely-but-real case (a charge that never had a destination).
      logger.warn("disputeRecovery: charge has no transfer to reverse", ctx);
      return empty;
    }

    const transfer = await stripe.transfers.retrieve(transferId);
    const destinationAccountId =
      typeof transfer.destination === "string"
        ? transfer.destination
        : (transfer.destination?.id ?? null);
    const amount = computeReversalCents({
      disputeAmountCents: input.disputeAmountCents,
      transferAmountCents: transfer.amount,
      alreadyReversedCents: transfer.amount_reversed ?? 0,
    });

    if (amount <= 0) {
      logger.info("disputeRecovery: transfer already fully reversed", {
        ...ctx,
        transferId,
      });
      return { ...empty, transferId, destinationAccountId };
    }

    const reversal = await stripe.transfers.createReversal(
      transferId,
      {
        amount,
        description: `Blue Seal dispute ${input.disputeId}`,
        metadata: { disputeId: input.disputeId, chargeId: input.chargeId },
      },
      { idempotencyKey: `dispute:${input.disputeId}:reversal:${amount}` },
    );

    logger.info("disputeRecovery: reversed transfer", {
      ...ctx,
      transferId,
      reversalId: reversal.id,
      amount,
    });
    return {
      status: "reversed",
      transferId,
      reversalId: reversal.id,
      reversedCents: amount,
      destinationAccountId,
      failureMessage: null,
    };
  } catch (err) {
    // The expected failure: the connected account has already paid out and
    // has no balance to reverse against. That is a debt to chase (ToS § 8.4),
    // not a crash — the webhook must still finish writing the dispute record.
    const info = stripeErrorInfo(err);
    logger.error("disputeRecovery: transfer reversal failed", { ...ctx, stripe: info });
    return {
      status: "failed",
      transferId: null,
      reversalId: null,
      reversedCents: 0,
      destinationAccountId: null,
      failureMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface RestoreOutcome {
  status: "restored" | "nothing_to_restore" | "failed";
  transferId: string | null;
  restoredCents: number;
  failureMessage: string | null;
}

/**
 * Give the clawed-back cents back to the tradesperson after a WON dispute.
 * The funds are on the platform balance (that's where the reversal put them),
 * so this is a fresh transfer to the same connected account.
 */
export async function restoreTransferForDispute(
  stripe: StripeClient,
  input: {
    disputeId: string;
    destinationAccountId: string;
    amountCents: number;
    currency: string;
  },
): Promise<RestoreOutcome> {
  if (input.amountCents <= 0) {
    return {
      status: "nothing_to_restore",
      transferId: null,
      restoredCents: 0,
      failureMessage: null,
    };
  }
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        destination: input.destinationAccountId,
        description: `Blue Seal dispute ${input.disputeId} won — funds restored`,
        metadata: { disputeId: input.disputeId, reason: "dispute_won" },
      },
      { idempotencyKey: `dispute:${input.disputeId}:restore:${input.amountCents}` },
    );
    logger.info("disputeRecovery: restored funds after won dispute", {
      disputeId: input.disputeId,
      transferId: transfer.id,
      amount: input.amountCents,
    });
    return {
      status: "restored",
      transferId: transfer.id,
      restoredCents: input.amountCents,
      failureMessage: null,
    };
  } catch (err) {
    logger.error("disputeRecovery: restore transfer failed", {
      disputeId: input.disputeId,
      stripe: stripeErrorInfo(err),
    });
    return {
      status: "failed",
      transferId: null,
      restoredCents: 0,
      failureMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
