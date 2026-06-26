// Monthly commission payout for BOTH sales reps and project managers (P4). On the
// 1st of each month, for every commission OWNER — `(ownerType, ownerId)`: net their
// unpaid commissions (sum of "accrued" minus the not-yet-netted "reversed" offsets),
// and if the net clears the $50 minimum, transfer it to the owner's Stripe Connect
// account and mark those ledger entries settled. Below the minimum rolls over to
// next month. Rep payouts read `users/{id}.salesRep.payouts`; PM payouts read
// `users/{id}.projectManager.payouts`. The export keeps its original name (it's a
// deployed scheduled function) even though it now covers both owner types.
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

type OwnerType = "rep" | "pm";

interface LedgerRow {
  id: string;
  ownerType: OwnerType;
  ownerId: string;
  commissionCents: number;
  createdAt: Timestamp | null;
}

// A row's owner: PM entries carry ownerType "pm" + ownerId; rep entries (incl.
// legacy rows with no ownerType) resolve to the rep via repId.
function toRow(doc: QueryDocumentSnapshot): LedgerRow {
  const data = doc.data();
  const ownerType: OwnerType = data.ownerType === "pm" ? "pm" : "rep";
  const ownerId = String((ownerType === "pm" ? data.ownerId : data.repId) ?? "");
  return {
    id: doc.id,
    ownerType,
    ownerId,
    commissionCents: Number(data.commissionCents ?? 0),
    createdAt: (data.createdAt as Timestamp | undefined) ?? null,
  };
}

// Group key combines type + id so a rep and a PM with the same uid (shouldn't
// happen, but is defended) never net together.
function ownerKey(row: LedgerRow): string {
  return `${row.ownerType}:${row.ownerId}`;
}

function pushGroup(map: Map<string, LedgerRow[]>, row: LedgerRow): void {
  if (!row.ownerId) return;
  const k = ownerKey(row);
  const arr = map.get(k);
  if (arr) arr.push(row);
  else map.set(k, [row]);
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

    // Group accrued by owner, and the not-yet-netted reversals (payoutBatchId null).
    const accruedByOwner = new Map<string, LedgerRow[]>();
    for (const doc of accruedSnap.docs) {
      pushGroup(accruedByOwner, toRow(doc));
    }
    const reversedByOwner = new Map<string, LedgerRow[]>();
    for (const doc of reversedSnap.docs) {
      if (doc.data().payoutBatchId != null) continue; // already netted in a prior batch
      pushGroup(reversedByOwner, toRow(doc));
    }

    let paid = 0;
    let rolled = 0;
    let skipped = 0;
    let failed = 0;

    for (const [key, accrued] of accruedByOwner) {
      const { ownerType, ownerId } = accrued[0];
      try {
        const reversed = reversedByOwner.get(key) ?? [];
        const plan = planRepPayout(
          accrued.map((r) => ({ id: r.id, commissionCents: r.commissionCents, createdAtMs: r.createdAt?.toMillis() ?? null })),
          reversed.map((r) => ({ id: r.id, commissionCents: r.commissionCents, createdAtMs: r.createdAt?.toMillis() ?? null })),
          now.toMillis(),
        );
        const net = plan.netCents;
        if (!plan.shouldPay) {
          rolled += 1;
          logger.info("scheduledRepCommissionPayouts: below minimum, rolling over", { ownerType, ownerId, net });
          continue;
        }

        // Rep payouts live on salesRep.payouts; PM payouts on projectManager.payouts.
        const ownerSnap = await db.doc(`users/${ownerId}`).get();
        const ownerData = ownerSnap.data() ?? {};
        const payouts = (ownerType === "pm"
          ? ownerData.projectManager?.payouts
          : ownerData.salesRep?.payouts) as
          | { stripeAccountId?: string; payoutsEnabled?: boolean }
          | undefined;
        if (!payouts?.stripeAccountId || !payouts.payoutsEnabled) {
          skipped += 1;
          logger.warn("scheduledRepCommissionPayouts: owner payouts not enabled, rolling over", {
            ownerType,
            ownerId,
            net,
          });
          continue;
        }

        // Step 1 — CLAIM atomically (accrued -> paid, reversals stamped, batch
        // pending). After this commits, a retry can't re-select these entries.
        const batchRef = db.collection("commissionPayouts").doc();
        const claim = db.batch();
        claim.set(batchRef, {
          ownerType,
          ownerId,
          // Keep repId on rep batches (legacy readers/rules key on it); null for PMs.
          repId: ownerType === "rep" ? ownerId : null,
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
        // (Rep key unchanged: `rep-payout-${id}-${period}`.)
        const stripe = getStripe();
        let transferId: string;
        try {
          const transfer = await stripe.transfers.create(
            {
              amount: net,
              currency: "cad",
              destination: payouts.stripeAccountId,
              metadata: { ownerType, ownerId, period, batchId: batchRef.id },
            },
            { idempotencyKey: `${ownerType}-payout-${ownerId}-${period}` },
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
            ownerType,
            ownerId,
            net,
            batchId: batchRef.id,
            err: transferErr instanceof Error ? transferErr.message : String(transferErr),
          });
          continue;
        }

        // Step 3a — confirm. If this update fails the owner is still paid exactly
        // once; the batch stays "pending" (recoverable) and we log loudly.
        await batchRef.update({ status: "paid", stripeTransferId: transferId });
        paid += 1;
        logger.info("scheduledRepCommissionPayouts: paid", {
          ownerType,
          ownerId,
          net,
          transferId,
          batchId: batchRef.id,
          count: plan.commissionIds.length,
        });
      } catch (err) {
        failed += 1;
        logger.error("scheduledRepCommissionPayouts: owner payout error", {
          ownerType,
          ownerId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("scheduledRepCommissionPayouts: done", {
      owners: accruedByOwner.size,
      paid,
      rolled,
      skipped,
      failed,
    });
  },
);
