// Pure netting + decision for a sales rep's monthly commission payout. Kept
// dependency-free + separate from the onSchedule wrapper so the money math is
// exhaustively unit-testable; the scheduler
// (functions/src/payments/scheduledRepCommissionPayouts.ts) owns the Firestore
// queries, the claim/transfer/unwind orchestration, and the Stripe transfer.

/** $50 CAD minimum net before a transfer goes out; a smaller net rolls over. */
export const MIN_PAYOUT_CENTS = 5000;

export interface PayoutLedgerRow {
  id: string;
  commissionCents: number;
  /** createdAt in epoch ms, or null if absent. */
  createdAtMs: number | null;
}

export interface RepPayoutPlan {
  accruedSum: number;
  reversedSum: number;
  netCents: number;
  shouldPay: boolean;
  /** accrued + reversed entry ids — everything this batch settles. */
  commissionIds: string[];
  /** earliest accrued timestamp (honest window label), else nowMs. */
  periodStartMs: number;
}

/**
 * net = sum(accrued) - sum(not-yet-netted reversed). Pay iff net >= minCents
 * (a below-minimum or negative net rolls over to next month). `reversed` must
 * already be filtered to entries that haven't been settled in a prior batch.
 */
export function planRepPayout(
  accrued: PayoutLedgerRow[],
  reversed: PayoutLedgerRow[],
  nowMs: number,
  minCents: number = MIN_PAYOUT_CENTS,
): RepPayoutPlan {
  const accruedSum = accrued.reduce((s, r) => s + r.commissionCents, 0);
  const reversedSum = reversed.reduce((s, r) => s + r.commissionCents, 0);
  const netCents = accruedSum - reversedSum;
  const periodStartMs = accrued.reduce(
    (min, r) => Math.min(min, r.createdAtMs ?? nowMs),
    nowMs,
  );
  return {
    accruedSum,
    reversedSum,
    netCents,
    shouldPay: netCents >= minCents,
    commissionIds: [...accrued.map((r) => r.id), ...reversed.map((r) => r.id)],
    periodStartMs,
  };
}
