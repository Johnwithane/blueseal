import type { ExpenseDoc, JobExtraDoc, TimeEntryDoc, WithId } from "@/firebase/interfaces";
import { entryBillable } from "@/firebase/services/timeEntries";

/** Running "charges so far" on a job, in cents, broken out by source. */
export interface JobChargesTally {
  /** Billable tracked time: labour, travel, and hourly change-order time. */
  timeCents: number;
  /** Billable receipts/materials — always 0 on a fixed-price job. */
  expenseCents: number;
  /** Approved FLAT change orders (hourly ones bill through `timeCents`). */
  changeOrderCents: number;
  /** Sum of the three above (pre-tax — tax is applied when the invoice is built). */
  totalCents: number;
}

/**
 * Live, pre-tax rollup of the charges accrued while the work happens — the
 * at-a-glance figure shown on the Work order tab.
 *
 * It sums the SAME three things the wrap-up sheet pulls into the invoice, using
 * the SAME billing rules as `FinishJobSheet.previewLines` so the running total
 * agrees with the invoice it previews. Keep the two in sync:
 *  - Time: un-invoiced entries for THIS tradesperson; running entries count
 *    (the server closes them on submit). $0 base labour on a fixed job is a
 *    time-only record, not a charge, so it's dropped — but hourly change-order
 *    time (rate > 0) still bills.
 *  - Expenses: NEVER billed on a fixed-price job (cost-tracking only); otherwise
 *    un-invoiced rows with a positive billed amount.
 *  - Change orders: approved + flat + un-invoiced (hourly extras bill via time).
 *
 * `expenses` is expected empty for the client (the receipts subcollection is
 * tradesperson-only by rule), which is why this returns each source separately:
 * the caller shows the client a materials-land-on-the-invoice note instead.
 */
export function rollUpJobCharges(args: {
  timeEntries: WithId<TimeEntryDoc>[];
  expenses: WithId<ExpenseDoc>[];
  extras: WithId<JobExtraDoc>[];
  tradespersonId: string;
  billingType: "hourly" | "fixed";
  nowMs: number;
}): JobChargesTally {
  const { timeEntries, expenses, extras, tradespersonId, billingType, nowMs } = args;

  let timeCents = 0;
  for (const e of timeEntries) {
    if (e.invoicedAt != null) continue;
    if (e.tradespersonId !== tradespersonId) continue;
    const { elapsedMs, billedAmount } = entryBillable(e, nowMs);
    if (elapsedMs <= 0) continue;
    const rate = Math.max(0, Math.floor(e.hourlyRateSnapshot));
    const kind = e.kind ?? "labour";
    if (kind === "labour" && rate === 0 && billingType === "fixed") continue;
    timeCents += billedAmount;
  }

  let expenseCents = 0;
  if (billingType !== "fixed") {
    for (const x of expenses) {
      if (x.invoicedAt != null) continue;
      if ((x.billedAmount ?? 0) <= 0) continue;
      expenseCents += x.billedAmount;
    }
  }

  let changeOrderCents = 0;
  for (const ex of extras) {
    if (ex.status !== "approved" || ex.invoicedAt != null) continue;
    if (ex.billingType !== "flat") continue;
    changeOrderCents += Math.max(0, Math.floor(ex.flatAmountCents ?? 0));
  }

  return {
    timeCents,
    expenseCents,
    changeOrderCents,
    totalCents: timeCents + expenseCents + changeOrderCents,
  };
}
