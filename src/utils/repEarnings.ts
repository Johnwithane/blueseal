// Client-side rollup of a sales rep's commission ledger into the figures the
// /sales dashboard shows: the unpaid balance the next monthly run will pay, the
// lifetime paid total, and per-tradesperson totals. Mirrors the server payout
// netting (functions/src/lib/commissionPayout.ts): unpaid = accrued minus the
// reversed entries not yet settled in a batch.

import type { CommissionDoc, CommissionPayoutDoc, WithId } from "@/firebase/interfaces";

/** $50 — mirror of the server scheduler's MIN_PAYOUT_CENTS. */
export const MIN_PAYOUT_CENTS = 5000;

export interface TradieEarning {
  tradespersonId: string;
  /** Paid + accrued counted positive, reversed negative. */
  netCents: number;
}

export interface RepEarningsSummary {
  /** Balance the next monthly payout will send (accrued minus un-netted reversed). */
  unpaidCents: number;
  /** Lifetime paid out, from settled payout batches. */
  lifetimePaidCents: number;
  /** Payout batches still pending/failed (a transfer in flight or needing attention). */
  pendingBatchCount: number;
  /** Distinct tradespeople who have generated commission for this rep. */
  earnerCount: number;
  /** Per-tradesperson net, highest first. */
  byTradie: TradieEarning[];
  /** True once the unpaid balance clears the monthly minimum. */
  meetsMinimum: boolean;
}

export function summarizeRepEarnings(
  commissions: WithId<CommissionDoc>[],
  payouts: WithId<CommissionPayoutDoc>[],
): RepEarningsSummary {
  let accrued = 0;
  let reversedUnnetted = 0;
  const byTradie = new Map<string, number>();

  for (const c of commissions) {
    const cents = c.commissionCents ?? 0;
    if (c.status === "accrued") accrued += cents;
    else if (c.status === "reversed" && c.payoutBatchId == null) reversedUnnetted += cents;

    const signed = c.status === "reversed" ? -cents : cents;
    byTradie.set(c.tradespersonId, (byTradie.get(c.tradespersonId) ?? 0) + signed);
  }

  const unpaidCents = Math.max(0, accrued - reversedUnnetted);
  const lifetimePaidCents = payouts
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + (p.amountCents ?? 0), 0);
  const pendingBatchCount = payouts.filter(
    (p) => p.status === "pending" || p.status === "failed",
  ).length;

  const earners: TradieEarning[] = [...byTradie.entries()]
    .map(([tradespersonId, netCents]) => ({ tradespersonId, netCents }))
    .sort((a, b) => b.netCents - a.netCents);

  return {
    unpaidCents,
    lifetimePaidCents,
    pendingBatchCount,
    earnerCount: byTradie.size,
    byTradie: earners,
    meetsMinimum: unpaidCents >= MIN_PAYOUT_CENTS,
  };
}
