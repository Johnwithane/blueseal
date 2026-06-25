// Monthly sales-rep commission payout. On the 1st of each month, for every rep:
// net their unpaid commissions (sum of "accrued" minus the not-yet-netted
// "reversed" offsets), and if the net clears the $50 minimum, transfer it to the
// rep's Stripe Connect account and mark those ledger entries settled. Below the
// minimum rolls over to next month.
//
// MONEY-SAFETY ORDERING (claim-before-pay). The cardinal sin here is paying a
// rep twice, so we CLAIM the commissions before moving money:
//   1. Atomically flip the accrued entries to "paid" + stamp the batch id, write
//      the payout batch as "pending". A scheduler retry now can't re-select them
//      (they're no longer "accrued"), so it can't double-pay.
//   2. stripe.transfers.create with a deterministic idempotency key, so even a
//      same-period retry between steps 1 and 3 reuses the one transfer.
//   3. Confirm the batch "paid" with the transfer id.
// If the transfer is REJECTED we unwind the claim (entries back to "accrued",
// batch "failed") so it retries next month. A crash after step 1 leaves a
// "pending" batch (the recoverable state) — the rep was paid at most once; M7's
// admin console reconciles pending batches. Under-pay is recoverable; double-pay
// is not, so we bias to under-pay.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { planRepPayout } from "../lib/commissionPayout";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";

const SCAN_LIMIT = 5000; // safety cap per run (logged if hit; remainder next run).

interface LedgerRow {
  id: string;
  repId: string;
  commissionCents: number;
  createdAt: Timestamp | null;
}

function toRow(doc: QueryDocumentSnapshot): LedgerRow {
  const data = doc.data();
  return {
    id: doc.id,
    repId: String(data.repId ?? ""),
    commissionCents: Number(data.commissionCents ?? 0),
    createdAt: (data.createdAt as Timestamp | undefined) ?? null,
  };
}

function pushGroup(map: Map<string, LedgerRow[]>, row: LedgerRow): void {
  const arr = map.get(row.repId);
  if (arr) arr.push(row);
  else map.set(row.repId, [row]);
}

export const scheduledRepCommissionPayouts = onSchedule(
  {
    schedule: "30 3 1 * *", // 03:30 on the 1st of every month
    timeZone: "America/Vancouver",
    secrets: [STRIPE_SECRET_KEY],
  },
  async () => {
    const now = Timestamp.now();
    const d = now.toDate();
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

    const [accruedSnap, reversedSnap] = await Promise.all([
      db.collection("commissions").where("status", "==", "accrued").limit(SCAN_LIMIT).get(),
      db.collection("commissions").where("status", "==", "reversed").limit(SCAN_LIMIT).get(),
    ]);
    if (accruedSnap.size === SCAN_LIMIT) {
      logger.warn("scheduledRepCommissionPayouts: accrued scan hit cap; remainder rolls to next run", {
        cap: SCAN_LIMIT,
      });
    }

    // Group accrued by rep, and the not-yet-netted reversals (payoutBatchId null).
    const accruedByRep = new Map<string, LedgerRow[]>();
    for (const doc of accruedSnap.docs) {
      const row = toRow(doc);
      if (row.repId) pushGroup(accruedByRep, row);
    }
    const reversedByRep = new Map<string, LedgerRow[]>();
    for (const doc of reversedSnap.docs) {
      if (doc.data().payoutBatchId != null) continue; // already netted in a prior batch
      const row = toRow(doc);
      if (row.repId) pushGroup(reversedByRep, row);
    }

    let paid = 0;
    let rolled = 0;
    let skipped = 0;
    let failed = 0;

    for (const [repId, accrued] of accruedByRep) {
      try {
        const reversed = reversedByRep.get(repId) ?? [];
        const plan = planRepPayout(
          accrued.map((r) => ({ id: r.id, commissionCents: r.commissionCents, createdAtMs: r.createdAt?.toMillis() ?? null })),
          reversed.map((r) => ({ id: r.id, commissionCents: r.commissionCents, createdAtMs: r.createdAt?.toMillis() ?? null })),
          now.toMillis(),
        );
        const net = plan.netCents;
        if (!plan.shouldPay) {
          rolled += 1;
          logger.info("scheduledRepCommissionPayouts: below minimum, rolling over", { repId, net });
          continue;
        }

        const repSnap = await db.doc(`users/${repId}`).get();
        const payouts = repSnap.data()?.salesRep?.payouts as
          | { stripeAccountId?: string; payoutsEnabled?: boolean }
          | undefined;
        if (!payouts?.stripeAccountId || !payouts.payoutsEnabled) {
          skipped += 1;
          logger.warn("scheduledRepCommissionPayouts: rep payouts not enabled, rolling over", {
            repId,
            net,
          });
          continue;
        }

        // Step 1 — CLAIM atomically (accrued -> paid, reversals stamped, batch
        // pending). After this commits, a retry can't re-select these entries.
        const batchRef = db.collection("commissionPayouts").doc();
        const claim = db.batch();
        claim.set(batchRef, {
          repId,
          stripeTransferId: null,
          amountCents: net,
          commissionIds: plan.commissionIds,
          periodStart: Timestamp.fromMillis(plan.periodStartMs),
          periodEnd: now,
          status: "pending",
          createdAt: FieldValue.serverTimestamp(),
        });
        for (const r of accrued) {
          claim.update(db.doc(`commissions/${r.id}`), { status: "paid", payoutBatchId: batchRef.id });
        }
        for (const r of reversed) {
          // Reversals stay "reversed" but are stamped so they're never netted again.
          claim.update(db.doc(`commissions/${r.id}`), { payoutBatchId: batchRef.id });
        }
        await claim.commit();

        // Step 2 — move the money. Idempotency key dedupes a same-period retry.
        const stripe = getStripe();
        let transferId: string;
        try {
          const transfer = await stripe.transfers.create(
            {
              amount: net,
              currency: "cad",
              destination: payouts.stripeAccountId,
              metadata: { repId, period, batchId: batchRef.id },
            },
            { idempotencyKey: `rep-payout-${repId}-${period}` },
          );
          transferId = transfer.id;
        } catch (transferErr) {
          // Step 3b — UNWIND the claim so it retries next month.
          const unwind = db.batch();
          unwind.update(batchRef, { status: "failed" });
          for (const r of accrued) {
            unwind.update(db.doc(`commissions/${r.id}`), { status: "accrued", payoutBatchId: null });
          }
          for (const r of reversed) {
            unwind.update(db.doc(`commissions/${r.id}`), { payoutBatchId: null });
          }
          await unwind.commit();
          failed += 1;
          logger.error("scheduledRepCommissionPayouts: transfer rejected, claim unwound", {
            repId,
            net,
            batchId: batchRef.id,
            err: transferErr instanceof Error ? transferErr.message : String(transferErr),
          });
          continue;
        }

        // Step 3a — confirm. If this update fails the rep is still paid exactly
        // once; the batch stays "pending" (recoverable) and we log loudly.
        await batchRef.update({ status: "paid", stripeTransferId: transferId });
        paid += 1;
        logger.info("scheduledRepCommissionPayouts: paid", {
          repId,
          net,
          transferId,
          batchId: batchRef.id,
          count: plan.commissionIds.length,
        });
      } catch (err) {
        failed += 1;
        logger.error("scheduledRepCommissionPayouts: rep payout error", {
          repId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("scheduledRepCommissionPayouts: done", {
      reps: accruedByRep.size,
      paid,
      rolled,
      skipped,
      failed,
    });
  },
);
