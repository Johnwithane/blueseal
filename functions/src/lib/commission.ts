// Sales-rep commission math (server mirror of src/utils/commission.ts). A rep
// earns 10% of the Blue Seal revenue their owned tradespeople generate: the Pro
// subscription amount + the platform portion of the per-job service fee. The
// accrual hooks (M5b) call commissionCents here.

export const COMMISSION_RATE_BPS = 1000; // 10%

export function commissionCents(
  grossCents: number,
  rateBps: number = COMMISSION_RATE_BPS,
): number {
  if (!Number.isFinite(grossCents) || grossCents <= 0) return 0;
  return Math.round((grossCents * rateBps) / 10000);
}
