// Sales-rep commission math. A rep earns a flat 10% of the Blue Seal revenue
// their owned tradespeople generate: the Pro subscription amount, and the
// platform portion of the per-job service fee. Mirrored server-side in
// functions/src/lib/commission.ts (the accrual hooks re-compute there).

/** 10%, in basis points. */
export const COMMISSION_RATE_BPS = 1000;

/**
 * Commission in cents = round(gross * rateBps / 10000). Non-positive gross
 * (refund edge, zero fee) yields 0 — reversals are recorded as separate
 * offsetting ledger entries, not negative accruals here.
 */
export function commissionCents(
  grossCents: number,
  rateBps: number = COMMISSION_RATE_BPS,
): number {
  if (!Number.isFinite(grossCents) || grossCents <= 0) return 0;
  return Math.round((grossCents * rateBps) / 10000);
}
