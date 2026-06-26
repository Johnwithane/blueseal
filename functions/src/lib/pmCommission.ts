// Resolve the project manager that DROVE a service-fee invoice's job and
// accrue/reverse their additive commission (P4). Keeps the PM resolution out of
// the Stripe webhook handlers so they just add one guarded call after the
// existing rep accrual/reversal. A job is PM-driven only when one of the PM's
// preferred contractors won a job they originated — acceptApplicationQuote stamps
// `drivenByProjectManagerId` exactly then, so this is null on every other job.

import { db } from "./admin";
import { notify } from "./notify";
import {
  accruePmCommission,
  reversePmCommission,
} from "./commissionAccrual";

/** The PM that drove a job, or null. Reads the immutable stamp set at acceptance. */
async function drivingPmId(jobId: string): Promise<string | null> {
  const snap = await db.doc(`jobs/${jobId}`).get();
  return (snap.data()?.drivenByProjectManagerId as string | null | undefined) ?? null;
}

/**
 * Accrue the PM's 10% on a paid service fee, if the job is PM-driven AND the PM is
 * still active (mirrors the rep path, which skips a deactivated rep). Best-effort:
 * the caller guards it so a commission failure never rolls back the payment.
 */
export async function accruePmServiceFee(args: {
  jobId: string;
  invoiceId: string;
  tradespersonId: string;
  grossCents: number;
}): Promise<void> {
  const pmId = await drivingPmId(args.jobId);
  if (!pmId) return;
  const pm = (await db.doc(`users/${pmId}`).get()).data()?.projectManager as
    | { active?: boolean }
    | undefined;
  if (!pm || pm.active === false) return;

  await accruePmCommission({
    pmId,
    tradespersonId: args.tradespersonId,
    source: "service_fee",
    sourceRef: args.invoiceId,
    grossCents: args.grossCents,
  });
}

/**
 * Reverse the PM's commission on a fully-refunded / lost-dispute service fee.
 * Resolves the PM from the immutable job stamp (NO active check — a reversal must
 * land even if the PM was deactivated since accrual); reversePmCommission no-ops
 * when there was no PM accrual. The invoiceId == jobId for service-fee invoices,
 * but we read the invoice's jobId field defensively.
 */
export async function reversePmServiceFee(args: { invoiceId: string }): Promise<void> {
  const invSnap = await db.doc(`invoices/${args.invoiceId}`).get();
  const jobId = (invSnap.data()?.jobId as string | undefined) ?? args.invoiceId;
  const pmId = await drivingPmId(jobId);
  if (!pmId) return;
  const reversedCents = await reversePmCommission({
    pmId,
    source: "service_fee",
    sourceRef: args.invoiceId,
  });
  // Only notify on a real clawback (a waived/Pro fee accrued nothing → no reversal).
  if (reversedCents && reversedCents > 0) {
    try {
      await notify({
        userId: pmId,
        type: "commission_reversed",
        title: "A commission was reversed",
        body: `A client refund reversed $${(reversedCents / 100).toFixed(2)} of your commission.`,
        link: "/manage/earnings",
        recipientRole: "projectManager",
        priority: "normal",
      });
    } catch {
      /* best-effort — the reversal itself already landed */
    }
  }
}
