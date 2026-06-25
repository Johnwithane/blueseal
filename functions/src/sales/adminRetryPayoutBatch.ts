// Admin-only: reconcile a PENDING payout batch. A batch is "pending" when the
// monthly scheduler claimed the commissions (flipped them to paid + wrote the
// batch) but didn't confirm the transfer — a crash between the transfer and the
// confirm-update, or a transfer still settling. We re-run the transfer with the
// SAME idempotency key the scheduler used (rep + YYYY-MM of periodEnd), so if the
// money already moved Stripe returns that same transfer (never a double-send);
// otherwise it sends now. Then we confirm the batch paid. Audited.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { STRIPE_SECRET_KEY, getStripe } from "../payments/stripeClient";

const Input = z.object({ batchId: z.string().trim().min(1).max(128) });

export const adminRetryPayoutBatch = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const actor = requireAdmin(req);
    const parsed = Input.safeParse(req.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input.");

    const ref = db.doc(`commissionPayouts/${parsed.data.batchId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Payout batch not found.");
    const batch = snap.data() as {
      repId?: string;
      amountCents?: number;
      status?: string;
      periodEnd?: Timestamp;
    };
    if (batch.status !== "pending") {
      throw new HttpsError("failed-precondition", "Only a pending batch can be retried.");
    }
    const amount = Number(batch.amountCents ?? 0);
    if (!batch.repId || amount <= 0) {
      throw new HttpsError("failed-precondition", "Batch is missing a rep or amount.");
    }

    const repSnap = await db.doc(`users/${batch.repId}`).get();
    const acct = repSnap.data()?.salesRep?.payouts?.stripeAccountId as string | undefined;
    if (!acct) throw new HttpsError("failed-precondition", "Rep has no connected payout account.");

    // Rebuild the scheduler's idempotency key from the batch's period so a retry
    // can never double-send the original transfer.
    const periodDate = (batch.periodEnd ?? Timestamp.now()).toDate();
    const period = `${periodDate.getUTCFullYear()}-${String(periodDate.getUTCMonth() + 1).padStart(2, "0")}`;

    const stripe = getStripe();
    const transfer = await stripe.transfers.create(
      {
        amount,
        currency: "cad",
        destination: acct,
        metadata: { repId: batch.repId, period, batchId: ref.id, reconciled: "true" },
      },
      { idempotencyKey: `rep-payout-${batch.repId}-${period}` },
    );

    await ref.set({ status: "paid", stripeTransferId: transfer.id }, { merge: true });
    await logAdminAction({
      actorUid: actor,
      action: "retryPayoutBatch",
      targetType: "commissionPayout",
      targetId: ref.id,
      metadata: { repId: batch.repId, amountCents: amount, transferId: transfer.id },
    });
    logger.info("adminRetryPayoutBatch", { actor, batchId: ref.id, transferId: transfer.id });
    return { ok: true, transferId: transfer.id };
  },
);
